/* eslint-disable @typescript-eslint/no-unused-vars -- `catch (e)` kept for older mobile browsers */
/*!
 * Lead Hub tracker. Paste on the landing page:
 *   <script src="https://<lead-hub>/tracker.js" data-key="pk_..." async></script>
 *
 * - Keeps the visit's UTMs, click ids (gclid, fbclid...) and Meta pixel
 *   cookies (_fbp/_fbc).
 * - Sends a page_view on load and a whatsapp_click whenever a WhatsApp link
 *   (wa.me, api.whatsapp.com, whatsapp://) is opened, so each click becomes a
 *   row in Lead Hub. Sending never delays or blocks the click.
 * - Adds a short code to the WhatsApp message ("cód. 7F3K") so the attendant
 *   can find the row and fill in the phone.
 *
 * API for pages that open WhatsApp from their own code:
 *   LeadHub.whatsappUrl(url, answers?) -> records the click, returns url with code
 *   LeadHub.set({ pergunta: "resposta" }) -> answers (e.g. a quiz) sent with the click
 *   LeadHub.identify({ name, phone })    -> contact typed on the page, sent with the click
 *   LeadHub.track("evento", { value })   -> records any other event
 *
 * Also records the commercial events the page already fires through the Meta
 * pixel or Google Tag Manager (Lead, Contact, Schedule, Purchase...), without
 * touching them. Page views, scrolls and similar events are ignored.
 */
(function () {
  "use strict";
  if (window.LeadHub && window.LeadHub.__loaded) return;

  var script =
    document.currentScript ||
    document.querySelector('script[src*="tracker.js"][data-key]');
  if (!script) return;

  var KEY = script.getAttribute("data-key");
  var ENDPOINT = new URL("/api/collect", script.src).toString();
  var CODE_ATTR = script.getAttribute("data-whatsapp-code"); // "false" disables
  var TRACKING_PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid",
    "campaign_id", "adset_id", "ad_id", "utm_id",
    "campaign_name", "adset_name", "ad_name", "placement", "site_source_name",
  ];
  var CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  var WHATSAPP_RE = /^(https?:\/\/(wa\.me|(api|web|www)\.whatsapp\.com)\/|whatsapp:\/\/)/i;
  var ATTR_TTL_MS = 90 * 24 * 60 * 60 * 1000;

  // --- storage (never throws: private mode, blocked storage...) ------------
  var memory = {};
  function get(name) {
    try {
      var v = window.localStorage.getItem(name);
      if (v !== null) return v;
    } catch (e) {}
    return memory[name] || null;
  }
  function set(name, value) {
    memory[name] = value;
    try {
      window.localStorage.setItem(name, value);
    } catch (e) {}
  }
  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function random(n, chars) {
    var out = "";
    var bytes = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
    return out;
  }

  var visitorId = get("lh_vid");
  if (!visitorId) {
    visitorId = random(20, "abcdefghijklmnopqrstuvwxyz0123456789");
    set("lh_vid", visitorId);
  }

  function code() {
    var c = get("lh_code");
    if (!c) {
      c = random(4, CODE_CHARS);
      set("lh_code", c);
    }
    return c;
  }

  // --- attribution ---------------------------------------------------------
  function readAttribution() {
    var stored = null;
    try {
      stored = JSON.parse(get("lh_attr") || "null");
    } catch (e) {}
    if (stored && Date.now() - stored.saved_at > ATTR_TTL_MS) stored = null;

    var params = new URLSearchParams(window.location.search);
    var fromUrl = {};
    var hasParams = false;
    TRACKING_PARAMS.forEach(function (p) {
      var v = params.get(p);
      if (v) {
        fromUrl[p] = v.slice(0, 500);
        hasParams = true;
      }
    });
    // Every other parameter too (custom ones the ad or the page may use).
    var all = {};
    var count = 0;
    params.forEach(function (v, k) {
      if (v && count < 30 && k.length <= 60) {
        all[k] = v.slice(0, 300);
        count++;
      }
    });
    if (count) fromUrl.url_params = all;

    // A visit that arrives with tracking params replaces the previous ones;
    // otherwise the last known source is kept (e.g. the visitor came back).
    var attr = stored;
    if (hasParams || !stored) {
      attr = fromUrl;
      attr.landing_url = window.location.href.split("#")[0];
      attr.referrer = document.referrer || null;
      attr.first_seen_at = (stored && stored.first_seen_at) || new Date().toISOString();
      attr.saved_at = Date.now();
      set("lh_attr", JSON.stringify(attr));
    }

    var result = {};
    for (var k in attr) if (k !== "saved_at" && k !== "url_params" && attr[k] != null) result[k] = attr[k];
    urlParams = attr.url_params || {};
    result.fbp = cookie("_fbp") || undefined;
    result.fbc =
      cookie("_fbc") ||
      (result.fbclid ? "fb.1." + (attr.saved_at || Date.now()) + "." + result.fbclid : undefined);
    return result;
  }

  var urlParams = {};
  var attribution = readAttribution();

  // --- sending -------------------------------------------------------------
  function send(event) {
    event.key = KEY;
    event.visitor_id = visitorId;
    event.url = window.location.href.split("#")[0];
    event.title = document.title;
    event.attribution = attribution;
    event.url_params = urlParams;
    var body = JSON.stringify(event);
    try {
      // text/plain avoids a CORS preflight; sendBeacon survives navigation.
      var blob = new Blob([body], { type: "text/plain" });
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
    } catch (e) {}
    try {
      fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } });
    } catch (e) {}
  }

  function codeEnabled() {
    if (CODE_ATTR === "false") return false;
    return get("lh_code_enabled") !== "false";
  }

  function fieldOnPage(selector, max) {
    var inputs = document.querySelectorAll(selector);
    for (var i = 0; i < inputs.length; i++) {
      var v = inputs[i].value && inputs[i].value.trim();
      if (v) return v.slice(0, max);
    }
    return undefined;
  }
  function nameOnPage() {
    return fieldOnPage(
      'input[name="nome" i], input[name="name" i], input[name*="nome" i], input[id*="nome" i], input[autocomplete="name"]',
      120
    );
  }
  function phoneOnPage() {
    return fieldOnPage(
      'input[type="tel"], input[name*="telefone" i], input[name*="phone" i], input[name*="whats" i], input[name*="celular" i], input[autocomplete="tel"]',
      40
    );
  }

  // Contact given through LeadHub.identify (e.g. a name/phone step before WhatsApp).
  var contact = {};
  try {
    contact = JSON.parse(window.sessionStorage.getItem("lh_contact") || "{}") || {};
  } catch (e) {}

  function withCode(url) {
    if (!codeEnabled()) return url;
    var tag = "(cód. " + code() + ")";
    try {
      var u = new URL(url);
      var text = u.searchParams.get("text");
      if (text && text.indexOf(tag) !== -1) return url;
      u.searchParams.set("text", text ? text + " " + tag : "Olá! Vim pelo site. " + tag);
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // Answers collected on the page (quiz, form steps) travel with the click and
  // end up as columns in the sheet. Kept for the tab's lifetime.
  var answers = {};
  try {
    answers = JSON.parse(window.sessionStorage.getItem("lh_answers") || "{}") || {};
  } catch (e) {}
  function setAnswers(values) {
    if (!values || typeof values !== "object") return;
    for (var k in values) {
      var v = values[k];
      if (v === null || v === undefined || v === "") delete answers[k];
      else answers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    try {
      window.sessionStorage.setItem("lh_answers", JSON.stringify(answers));
    } catch (e) {}
  }

  var lastClick = 0;
  function recordClick(url) {
    var now = Date.now();
    if (now - lastClick < 1500) return; // one click, one row
    lastClick = now;
    var data = { whatsapp_url: String(url).split("?")[0] };
    for (var k in answers) data[k] = answers[k];
    send({
      type: "whatsapp_click",
      code: codeEnabled() ? code() : undefined,
      name: contact.name || nameOnPage(),
      phone: contact.phone || phoneOnPage(),
      data: data,
    });
  }

  function isWhatsApp(url) {
    return typeof url === "string" && WHATSAPP_RE.test(url);
  }

  // Links: rewrite the href before the browser follows it.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !isWhatsApp(a.href)) return;
      a.href = withCode(a.href);
      recordClick(a.href);
    },
    true
  );

  // Buttons that call window.open("https://wa.me/...").
  var originalOpen = window.open;
  window.open = function (url) {
    var args = Array.prototype.slice.call(arguments);
    if (isWhatsApp(String(url))) {
      args[0] = withCode(String(url));
      recordClick(args[0]);
    }
    return originalOpen.apply(window, args);
  };

  // Learn the page's settings for next time (the first click uses the default).
  function pageView() {
    send({ type: "page_view" });
    try {
      fetch(ENDPOINT + "?key=" + encodeURIComponent(KEY), { method: "GET" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (cfg) {
          if (cfg && typeof cfg.whatsapp_code === "boolean") set("lh_code_enabled", String(cfg.whatsapp_code));
        })
        .catch(function () {});
    } catch (e) {}
  }

  // --- events the page already fires (Meta pixel, Google Tag Manager) -----
  // Read-only: the pixel's own requests are observed and GTM's dataLayer is
  // read; neither is changed. Views, scrolls and other events with no
  // commercial meaning are dropped.
  var NOISE =
    /^(pageview|page_view|viewcontent|view_content|view_item|view_item_list|view_promotion|view_search_results|scroll|scroll_depth|user_engagement|session_start|first_visit|timer|click|file_download|form_start|video_start|video_progress|video_complete|subscribedbuttonclick|microdata|inputdata|(gtm|gtag|optimize)\..*)$/i;
  // Google's recommended names shown with Meta's standard names.
  var GA4_TO_META = {
    generate_lead: "Lead",
    sign_up: "CompleteRegistration",
    begin_checkout: "InitiateCheckout",
    add_to_cart: "AddToCart",
    add_payment_info: "AddPaymentInfo",
    purchase: "Purchase",
    contact: "Contact",
    schedule: "Schedule",
    subscribe: "Subscribe",
  };
  var lastEvent = {};
  var eventCount = 0;
  function pageEvent(name, source, params) {
    if (typeof name !== "string") return;
    name = name.replace(/^\s+|\s+$/g, "").slice(0, 60);
    if (!name || NOISE.test(name)) return;
    name = GA4_TO_META[name.toLowerCase()] || name;
    var now = Date.now();
    if (lastEvent[name] && now - lastEvent[name] < 3000) return; // same event from pixel and GTM
    lastEvent[name] = now;
    if (++eventCount > 40) return;
    var data = { event: name, source: source };
    if (params && typeof params === "object") {
      ["value", "currency", "content_name", "pixel_id"].forEach(function (k) {
        var v = params[k];
        if ((typeof v === "string" && v && v.length <= 100) || (typeof v === "number" && isFinite(v))) data[k] = v;
      });
    }
    send({ type: "lp_event", data: data });
  }

  function pixelRequest(url) {
    if (typeof url !== "string" || !/^https:\/\/(www\.)?facebook\.com\/tr\/?\?/.test(url)) return;
    var q;
    try {
      q = new URL(url).searchParams;
    } catch (e) {
      return;
    }
    pageEvent(q.get("ev"), "pixel", {
      value: q.get("cd[value]"),
      currency: q.get("cd[currency]"),
      content_name: q.get("cd[content_name]"),
      pixel_id: q.get("id"),
    });
  }

  var layerIndex = 0;
  function readDataLayer() {
    var layer = window.dataLayer;
    if (!layer || typeof layer.length !== "number") return;
    for (; layerIndex < layer.length; layerIndex++) {
      var item = layer[layerIndex];
      if (!item || typeof item !== "object") continue;
      if (item[0] === "event" && typeof item[1] === "string") {
        pageEvent(item[1], "gtag", item[2]); // gtag("event", name, params)
      } else if (typeof item.event === "string") {
        pageEvent(item.event, "gtm", item.ecommerce && typeof item.ecommerce === "object" ? item.ecommerce : item);
      }
    }
  }

  var api = {
    __loaded: true,
    visitorId: visitorId,
    whatsappUrl: function (url, values) {
      setAnswers(values);
      var withTag = withCode(url);
      recordClick(withTag);
      return withTag;
    },
    set: setAnswers,
    identify: function (info) {
      if (!info) return;
      if (info.name) contact.name = String(info.name).trim().slice(0, 120);
      if (info.phone) contact.phone = String(info.phone).trim().slice(0, 40);
      try {
        window.sessionStorage.setItem("lh_contact", JSON.stringify(contact));
      } catch (e) {}
      // Also updates a row created by an earlier click of this visitor.
      if (contact.name || contact.phone) send({ type: "identify", name: contact.name, phone: contact.phone });
    },
    track: function (type, data) {
      pageEvent(type, "api", data);
    },
  };
  window.LeadHub = api;

  try {
    if (window.PerformanceObserver) {
      // buffered: also sees what the pixel sent before this script loaded.
      new PerformanceObserver(function (list) {
        if (window.LeadHub !== api) return;
        list.getEntries().forEach(function (entry) {
          pixelRequest(entry.name);
        });
      }).observe({ type: "resource", buffered: true });
    }
  } catch (e) {}

  var polls = 0;
  (function poll() {
    if (window.LeadHub !== api) return;
    try {
      readDataLayer();
    } catch (e) {}
    if (++polls < 1800) setTimeout(poll, 1000);
  })();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", pageView);
  } else {
    pageView();
  }
})();
