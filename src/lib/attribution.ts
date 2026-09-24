// Blueprint §6.2 / §6.3: classify where a visit came from.

export const CHANNELS = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  microsoft_ads: "Microsoft Ads",
  paid_other: "Mídia paga (outra)",
  instagram_organic: "Instagram orgânico",
  organic_social: "Social orgânico",
  google_organic: "Google orgânico",
  organic_search: "Busca orgânica",
  email: "E-mail",
  referral: "Referral",
  direct: "Direct",
  whatsapp_direto: "WhatsApp direto",
} as const;

export type Channel = keyof typeof CHANNELS;

export interface TouchSignals {
  utm_source?: string | null;
  utm_medium?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  referrer?: string | null;
  landing_page_url?: string | null;
}

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "cpm",
  "cpv",
  "paid",
  "paid_social",
  "paidsocial",
  "paid-social",
  "social_paid",
  "ads",
  "ad",
  "display",
  "retargeting",
]);
const META_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "meta", "facebook_ads", "instagram_ads", "an", "msg"]);
const GOOGLE_SOURCES = new Set(["google", "adwords", "google_ads", "youtube"]);
const ORGANIC_MEDIUMS = new Set(["organic", "social", "bio", "post", "stories", "story", "reels"]);

const SEARCH_ENGINES = [/(^|\.)bing\.com$/, /(^|\.)duckduckgo\.com$/, /(^|\.)search\.yahoo\.com$/, /(^|\.)yandex\./, /(^|\.)ecosia\.org$/];
const SOCIAL_SITES = [
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.com$/,
  /(^|\.)instagram\.com$/,
  /^t\.co$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)linkedin\.com$/,
  /^lnkd\.in$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)pinterest\./,
  /(^|\.)threads\.net$/,
  /(^|\.)whatsapp\.com$/,
];

const lower = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function classifyChannel(t: TouchSignals): Channel {
  const source = lower(t.utm_source);
  const medium = lower(t.utm_medium);
  const paid = PAID_MEDIUMS.has(medium);

  // 1. Click identifiers.
  if (t.gclid || t.gbraid || t.wbraid) return "google_ads";
  if (t.fbclid && (paid || !medium)) return "meta_ads";
  if (t.ttclid) return "tiktok_ads";
  if (t.msclkid) return "microsoft_ads";

  // 2. UTMs without a click identifier.
  if (source || medium) {
    if (META_SOURCES.has(source)) {
      if (paid) return "meta_ads";
      if ((source === "instagram" || source === "ig") && (ORGANIC_MEDIUMS.has(medium) || !medium)) {
        return "instagram_organic";
      }
      return "organic_social";
    }
    if (GOOGLE_SOURCES.has(source) && paid) return "google_ads";
    if (source === "tiktok" && paid) return "tiktok_ads";
    if ((source === "bing" || source === "microsoft") && paid) return "microsoft_ads";
    if (paid) return "paid_other";
    if (medium === "email" || medium === "e-mail" || medium === "newsletter") return "email";
    if (ORGANIC_MEDIUMS.has(medium) && medium !== "organic") return "organic_social";
    return "referral";
  }

  // fbclid on an organic share (medium says so) lands here.
  if (t.fbclid) return "organic_social";

  // 3. Referrer.
  const ref = hostOf(t.referrer);
  const self = hostOf(t.landing_page_url);
  if (ref && ref !== self) {
    if (/(^|\.)google\.[a-z.]+$/.test(ref)) return "google_organic";
    if (SEARCH_ENGINES.some((re) => re.test(ref))) return "organic_search";
    if (/(^|\.)instagram\.com$/.test(ref) || ref === "l.instagram.com") return "instagram_organic";
    if (SOCIAL_SITES.some((re) => re.test(ref))) return "organic_social";
    return "referral";
  }

  // 4. Nothing trustworthy.
  return "direct";
}

export function channelLabel(channel: string | null | undefined): string {
  return (channel && CHANNELS[channel as Channel]) || "Desconhecido";
}
