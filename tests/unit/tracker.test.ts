// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public/tracker.js"), "utf8");

type Sent = Record<string, unknown> & { type: string; attribution: Record<string, string> };

let listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];

/** Runs tracker.js as a fresh page load and captures what it sends. */
function load(url: string, { referrer = "", attrs = {} as Record<string, string> } = {}) {
  // Forget the previous "page": its document listeners would still fire.
  for (const [type, fn, opts] of listeners) document.removeEventListener(type, fn, opts);
  listeners = [];
  window.history.replaceState(null, "", url);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  document.body.innerHTML = "";

  const sent: Sent[] = [];
  // Without sendBeacon the tracker falls back to fetch, whose body is a string.
  Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ whatsapp_code: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const openMock = vi.fn();
  window.open = openMock as never;

  const script = document.createElement("script");
  script.src = "https://leadhub.test/tracker.js";
  script.setAttribute("data-key", "pk_test");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  document.head.appendChild(script);
  delete (window as { LeadHub?: unknown }).LeadHub;

  const add = document.addEventListener.bind(document);
  document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    listeners.push([type, fn, opts]);
    add(type, fn, opts);
  }) as typeof document.addEventListener;
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  try {
    new Function(SOURCE)();
  } finally {
    Object.defineProperty(document, "currentScript", { value: null, configurable: true });
    document.addEventListener = add;
  }

  const posted = () => fetchMock.mock.calls.filter(([u, init]) => init?.method === "POST" && u === "https://leadhub.test/api/collect");
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { sent, posted, openMock, flush };
}

function whatsappLink(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = "Falar no WhatsApp";
  a.addEventListener("click", (e) => e.preventDefault()); // keep jsdom from navigating
  document.body.appendChild(a);
  return a;
}

describe("tracker.js", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "_fbp=fb.1.1727180000.987654";
    document.cookie = "_fbc=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("sends a page view with UTMs, click ids and the Meta pixel cookie", async () => {
    const { sent, posted, flush } = load(
      "/transplante?utm_source=facebook&utm_medium=paid&utm_campaign=sp&ad_id=123&fbclid=IwAR3x",
      { referrer: "https://l.facebook.com/" },
    );
    await flush();
    expect(posted()).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      key: "pk_test",
      type: "page_view",
      attribution: {
        utm_source: "facebook",
        utm_campaign: "sp",
        ad_id: "123",
        fbclid: "IwAR3x",
        fbp: "fb.1.1727180000.987654",
        referrer: "https://l.facebook.com/",
      },
    });
    expect(sent[0].attribution.fbc).toMatch(/^fb\.1\.\d+\.IwAR3x$/);
    expect(String(sent[0].visitor_id)).toMatch(/^[a-z0-9]{20}$/);
  });

  it("keeps the campaign when the visitor comes back without UTMs", async () => {
    load("/?utm_source=google&utm_medium=cpc&gclid=abc");
    const { sent, flush } = load("/outra-pagina");
    await flush();
    expect(sent[0].attribution).toMatchObject({ utm_source: "google", gclid: "abc" });
  });

  it("records a WhatsApp click and adds the code to the message", async () => {
    const { sent, flush } = load("/?utm_campaign=sp");
    const a = whatsappLink("https://wa.me/5511999999999?text=Quero%20agendar");
    a.click();
    await flush();

    const click = sent.find((e) => e.type === "whatsapp_click")!;
    expect(click.code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    const text = new URL(a.href).searchParams.get("text");
    expect(text).toBe(`Quero agendar (cód. ${click.code})`);
    expect(click.attribution.utm_campaign).toBe("sp");
  });

  it("writes a greeting when the link has no message", async () => {
    load("/");
    const a = whatsappLink("https://api.whatsapp.com/send?phone=5511999999999");
    a.click();
    expect(new URL(a.href).searchParams.get("text")).toMatch(/^Olá! Vim pelo site\. \(cód\. [2-9A-HJ-NP-Z]{4}\)$/);
  });

  it("uses the same code on every click of the same visitor", async () => {
    const { sent, flush } = load("/");
    const a = whatsappLink("https://wa.me/5511999999999");
    a.click();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    load("/");
    const b = whatsappLink("https://wa.me/5511999999999");
    b.click();
    vi.restoreAllMocks();
    await flush();
    const codes = [a.href, b.href].map((h) => new URL(h).searchParams.get("text")!.match(/cód\. (\w+)/)![1]);
    expect(codes[0]).toBe(codes[1]);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("ignores links that are not WhatsApp", async () => {
    const { sent, flush } = load("/");
    const a = whatsappLink("https://instagram.com/draleticia");
    a.click();
    await flush();
    expect(sent.some((e) => e.type === "whatsapp_click")).toBe(false);
    expect(a.href).toBe("https://instagram.com/draleticia");
  });

  it("does not add the code when the page turns it off", async () => {
    const { sent, flush } = load("/", { attrs: { "data-whatsapp-code": "false" } });
    const a = whatsappLink("https://wa.me/5511999999999?text=Oi");
    a.click();
    await flush();
    expect(new URL(a.href).searchParams.get("text")).toBe("Oi");
    expect(sent.find((e) => e.type === "whatsapp_click")?.code).toBeUndefined();
  });

  it("catches window.open and picks up a name typed on the page", async () => {
    const { sent, openMock, flush } = load("/");
    document.body.innerHTML = '<input name="nome" value="  Maria Souza ">';
    window.open("https://wa.me/5511999999999?text=Oi", "_blank");
    await flush();
    expect(String(openMock.mock.calls[0][0])).toMatch(/text=Oi\+%28c%C3%B3d\.\+[2-9A-HJ-NP-Z]{4}%29/);
    expect(sent.find((e) => e.type === "whatsapp_click")).toMatchObject({ name: "Maria Souza" });
  });

  it("offers an API for pages that build the WhatsApp URL themselves", async () => {
    const { sent, flush } = load("/");
    const api = (window as unknown as { LeadHub: { whatsappUrl(u: string): string; identify(i: object): void; track(t: string, d: object): void } }).LeadHub;
    const url = api.whatsappUrl("https://wa.me/5511999999999");
    api.identify({ name: "João" });
    api.track("form_step", { step: 2 });
    await flush();
    expect(url).toMatch(/c%C3%B3d/);
    expect(sent.map((e) => e.type)).toEqual(["page_view", "whatsapp_click", "identify", "lp_event"]);
    expect(sent.at(-1)?.data).toEqual({ event: "form_step", source: "api" });
  });

  describe("consent (LGPD)", () => {
    beforeEach(() => {
      delete (window as { fbq?: unknown }).fbq;
      delete (window as { gtag?: unknown }).gtag;
      delete (window as { lhConsent?: unknown }).lhConsent;
    });
    const banner = () => document.querySelector("[data-leadhub-consent]");
    const button = (label: string) =>
      [...(banner()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label) as HTMLButtonElement;

    it("tracks nothing before the visitor answers, but still records the contact on a WhatsApp click", async () => {
      const { sent, flush } = load("/?utm_source=facebook&fbclid=IwAR1", { attrs: { "data-consent": "banner" } });
      await flush();
      expect(sent).toEqual([]);
      expect(banner()?.textContent).toContain("Política de privacidade");
      expect(banner()?.querySelector("a")?.getAttribute("href")).toBe("https://leadhub.test/privacidade/pk_test");
      expect(localStorage.getItem("lh_vid")).toBeNull();

      const input = document.createElement("input");
      input.name = "nome";
      input.value = "Ana";
      document.body.appendChild(input);
      whatsappLink("https://wa.me/5511999999999").click();
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "whatsapp_click", consent: false, name: "Ana" });
      expect(sent[0]).not.toHaveProperty("attribution");
      expect(sent[0]).not.toHaveProperty("url_params");
      expect(Object.keys(localStorage).filter((k) => k.startsWith("lh_"))).toEqual([]);
    });

    it("starts tracking when the visitor accepts, and releases the pixel and Google tags", async () => {
      const fbq = vi.fn();
      const gtag = vi.fn();
      Object.assign(window, { fbq, gtag });
      const { sent, flush } = load("/?utm_source=facebook&fbclid=IwAR1", { attrs: { "data-consent": "banner" } });
      button("Aceitar").click();
      await flush();
      expect(banner()).toBeNull();
      expect(localStorage.getItem("lh_consent")).toBe("granted");
      expect(fbq).toHaveBeenCalledWith("consent", "grant");
      expect(gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ ad_storage: "granted" }));
      expect(sent[0]).toMatchObject({ type: "page_view", consent: true, attribution: { utm_source: "facebook" } });
      expect(localStorage.getItem("lh_vid")).toBeTruthy();

      // Next visit: no banner, tracking right away.
      const again = load("/", { attrs: { "data-consent": "banner" } });
      await again.flush();
      expect(banner()).toBeNull();
      expect(again.sent[0]).toMatchObject({ type: "page_view", consent: true });
    });

    it("remembers a refusal and erases what was stored", async () => {
      const fbq = vi.fn();
      Object.assign(window, { fbq });
      localStorage.setItem("lh_vid", "antigo123456");
      const { sent, flush } = load("/", { attrs: { "data-consent": "banner" } });
      button("Recusar").click();
      await flush();
      expect(fbq).toHaveBeenCalledWith("consent", "revoke");
      expect(localStorage.getItem("lh_consent")).toBe("denied");
      expect(localStorage.getItem("lh_vid")).toBeNull();
      expect(sent).toEqual([]);

      const again = load("/", { attrs: { "data-consent": "banner" } });
      await again.flush();
      expect(banner()).toBeNull();
      expect(again.sent).toEqual([]);
    });

    it("follows the page's own cookie banner in required mode", async () => {
      const { sent, flush } = load("/", { attrs: { "data-consent": "required" } });
      await flush();
      expect(banner()).toBeNull();
      expect(sent).toEqual([]);
      const api = (window as unknown as { LeadHub: { consent(v: boolean): void; consentStatus(): string } }).LeadHub;
      expect(api.consentStatus()).toBe("pending");
      api.consent(true);
      await flush();
      expect(api.consentStatus()).toBe("granted");
      expect(sent.map((e) => e.type)).toEqual(["page_view"]);
    });

    it("keeps the original behaviour on pages without the option", async () => {
      const { sent, flush } = load("/");
      await flush();
      expect(sent[0].type).toBe("page_view");
      expect(sent[0]).not.toHaveProperty("consent");
      expect(banner()).toBeNull();
    });
  });

  describe("events the page already fires", () => {
    type Observer = (list: { getEntries(): { name: string }[] }) => void;
    let observers: Observer[] = [];
    beforeEach(() => {
      observers = [];
      vi.stubGlobal(
        "PerformanceObserver",
        class {
          constructor(cb: Observer) {
            observers.push(cb);
          }
          observe() {}
        },
      );
      delete (window as { dataLayer?: unknown }).dataLayer;
    });
    const pixel = (...urls: string[]) => observers.at(-1)!({ getEntries: () => urls.map((name) => ({ name })) });
    const events = (sent: Sent[]) => sent.filter((e) => e.type === "lp_event").map((e) => e.data);

    it("reads the Meta pixel's requests without touching the pixel, and skips page views", async () => {
      const fbq = vi.fn();
      (window as unknown as { fbq: unknown }).fbq = fbq;
      const { sent, flush } = load("/");
      pixel(
        "https://www.facebook.com/tr/?id=123456789012345&ev=PageView&dl=x",
        "https://www.facebook.com/tr/?id=123456789012345&ev=Lead&cd[value]=150&cd[currency]=BRL",
        "https://connect.facebook.net/en_US/fbevents.js",
        "https://www.facebook.com/tr/?id=123456789012345&ev=ViewContent",
      );
      await flush();
      expect(events(sent)).toEqual([{ event: "Lead", source: "pixel", value: "150", currency: "BRL", pixel_id: "123456789012345" }]);
      expect((window as unknown as { fbq: unknown }).fbq).toBe(fbq);
    });

    it("reads Google Tag Manager and gtag events, with Google names shown as Meta's", async () => {
      // gtag() pushes its `arguments` object, not an array.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      function gtagArgs(..._a: unknown[]) {
        // eslint-disable-next-line prefer-rest-params
        return arguments;
      }
      const layer: unknown[] = [
        { event: "gtm.js" },
        { event: "scroll_depth" },
        { event: "quiz_concluido", etapa: 3 },
        gtagArgs("event", "generate_lead", { value: 90, currency: "BRL" }),
        gtagArgs("config", "G-XYZ"),
      ];
      (window as unknown as { dataLayer: unknown[] }).dataLayer = layer;
      const { sent, flush } = load("/");
      await flush();
      expect(events(sent)).toEqual([
        { event: "quiz_concluido", source: "gtm" },
        { event: "Lead", source: "gtag", value: 90, currency: "BRL" },
      ]);
      expect(layer).toHaveLength(5);
    });

    it("counts an event sent by both the pixel and GTM once", async () => {
      (window as unknown as { dataLayer: unknown[] }).dataLayer = [{ event: "Contact" }];
      const { sent, flush } = load("/");
      pixel("https://www.facebook.com/tr/?id=1&ev=Contact");
      await flush();
      expect(events(sent)).toEqual([{ event: "Contact", source: "gtm" }]);
    });

    it("keeps reading events pushed later", async () => {
      const layer: unknown[] = [];
      (window as unknown as { dataLayer: unknown[] }).dataLayer = layer;
      const { sent } = load("/");
      layer.push({ event: "Schedule" });
      await new Promise((r) => setTimeout(r, 1100));
      expect(events(sent)).toEqual([{ event: "Schedule", source: "gtm" }]);
    });
  });

  it("sends quiz answers with the click", async () => {
    const { sent, flush } = load("/");
    const api = (window as unknown as { LeadHub: { set(v: object): void; whatsappUrl(u: string, v?: object): string } }).LeadHub;
    api.set({ tempo_de_queda: "Mais de 5 anos", areas: ["Coroa", "Entradas"] });
    api.set({ ja_fez_tratamento: false, vazio: "" });
    api.whatsappUrl("https://wa.me/5511999999999", { investimento: "R$ 15 a 25 mil" });
    await flush();
    const click = sent.find((e) => e.type === "whatsapp_click")!;
    expect(click.data).toEqual({
      whatsapp_url: "https://wa.me/5511999999999",
      tempo_de_queda: "Mais de 5 anos",
      areas: "Coroa, Entradas",
      ja_fez_tratamento: false,
      investimento: "R$ 15 a 25 mil",
    });
  });

  it("sends the name and phone given with identify along with the click", async () => {
    const { sent, flush } = load("/");
    const api = (window as unknown as { LeadHub: { identify(i: object): void; whatsappUrl(u: string): string } }).LeadHub;
    api.identify({ name: " Ana Lima ", phone: "(11) 91234-5678" });
    api.whatsappUrl("https://wa.me/5511999999999");
    await flush();
    expect(sent.find((e) => e.type === "identify")).toMatchObject({ name: "Ana Lima", phone: "(11) 91234-5678" });
    expect(sent.find((e) => e.type === "whatsapp_click")).toMatchObject({ name: "Ana Lima", phone: "(11) 91234-5678" });
  });

  it("picks up a phone field typed on the page", async () => {
    const { sent, flush } = load("/");
    document.body.innerHTML = '<input name="nome" value="Bia"><input type="tel" name="whatsapp" value="11 98888-7777">';
    window.open("https://wa.me/5511999999999");
    await flush();
    expect(sent.find((e) => e.type === "whatsapp_click")).toMatchObject({ name: "Bia", phone: "11 98888-7777" });
  });

  it("keeps Meta's names and every URL parameter", async () => {
    const { sent, flush } = load(
      "/?utm_source=facebook&utm_campaign=Transplante%20SP&campaign_name=Transplante%20SP&adset_name=SP%2030-55&ad_name=V%C3%ADdeo%2001&placement=Instagram_Stories&criativo=v1",
    );
    await flush();
    expect(sent[0].attribution).toMatchObject({
      campaign_name: "Transplante SP",
      adset_name: "SP 30-55",
      ad_name: "Vídeo 01",
      placement: "Instagram_Stories",
    });
    expect(sent[0].url_params).toMatchObject({ criativo: "v1", utm_source: "facebook" });
  });
});
