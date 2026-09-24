import { describe, expect, it } from "vitest";
import { classifyChannel } from "@/lib/attribution";

// Blueprint §6.2 / §6.3.
describe("classifyChannel", () => {
  it.each([
    [{ gclid: "abc" }, "google_ads"],
    [{ gbraid: "abc" }, "google_ads"],
    [{ wbraid: "abc", utm_source: "facebook" }, "google_ads"],
    [{ fbclid: "abc" }, "meta_ads"],
    [{ fbclid: "abc", utm_source: "facebook", utm_medium: "paid" }, "meta_ads"],
    [{ utm_source: "instagram", utm_medium: "cpc" }, "meta_ads"],
    [{ utm_source: "facebook", utm_medium: "paid_social" }, "meta_ads"],
    [{ utm_source: "instagram", utm_medium: "organic" }, "instagram_organic"],
    [{ utm_source: "ig", utm_medium: "bio" }, "instagram_organic"],
    [{ fbclid: "abc", utm_source: "instagram", utm_medium: "organic" }, "instagram_organic"],
    [{ utm_source: "facebook", utm_medium: "social" }, "organic_social"],
    [{ utm_source: "google", utm_medium: "cpc" }, "google_ads"],
    [{ ttclid: "x" }, "tiktok_ads"],
    [{ msclkid: "x" }, "microsoft_ads"],
    [{ utm_source: "parceiro", utm_medium: "cpc" }, "paid_other"],
    [{ utm_source: "newsletter", utm_medium: "email" }, "email"],
    [{ utm_source: "parceiro" }, "referral"],
    [{ referrer: "https://www.google.com.br/" }, "google_organic"],
    [{ referrer: "https://duckduckgo.com/" }, "organic_search"],
    [{ referrer: "https://l.instagram.com/" }, "instagram_organic"],
    [{ referrer: "https://m.facebook.com/" }, "organic_social"],
    [{ referrer: "https://blog.parceiro.com/post" }, "referral"],
    [{ referrer: "https://site.com.br/outra", landing_page_url: "https://site.com.br/lp" }, "direct"],
    [{}, "direct"],
  ])("classifies %j as %s", (signals, expected) => {
    expect(classifyChannel(signals)).toBe(expected);
  });

  it("prefers click ids over the referrer", () => {
    expect(classifyChannel({ gclid: "x", referrer: "https://facebook.com" })).toBe("google_ads");
  });
});
