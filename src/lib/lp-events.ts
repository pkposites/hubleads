/**
 * Events the landing page fires (Meta pixel, Google Tag Manager or
 * LeadHub.track). Only the ones with commercial meaning are kept; the same
 * list lives in public/tracker.js and in lh_private.is_noise_event().
 */
export const NOISE_EVENT =
  /^(pageview|page_view|viewcontent|view_content|view_item|view_item_list|view_promotion|view_search_results|scroll|scroll_depth|user_engagement|session_start|first_visit|timer|click|file_download|form_start|video_start|video_progress|video_complete|subscribedbuttonclick|microdata|inputdata|(gtm|gtag|optimize)\..*)$/i;

export const isNoiseEvent = (name: string) => NOISE_EVENT.test(name.trim());

/** Meta's standard events in Portuguese; anything else keeps its own name. */
const LABELS: Record<string, string> = {
  Lead: "Lead (cadastro)",
  Contact: "Contato",
  Schedule: "Agendamento",
  CompleteRegistration: "Cadastro completo",
  SubmitApplication: "Envio de formulário",
  InitiateCheckout: "Início de checkout",
  AddToCart: "Adicionou ao carrinho",
  AddToWishlist: "Lista de desejos",
  AddPaymentInfo: "Dados de pagamento",
  Purchase: "Compra",
  Subscribe: "Assinatura",
  StartTrial: "Início de teste",
  Search: "Busca",
  FindLocation: "Procurou endereço",
  CustomizeProduct: "Personalizou produto",
  Donate: "Doação",
};

export function eventLabel(name: string) {
  if (LABELS[name]) return LABELS[name];
  const text = name.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface LpEvent {
  event: string;
  source: string | null;
  value: number | string | null;
  at: string;
}

export interface LpEventMetric {
  event: string;
  people: number;
  events: number;
  leads: number;
  sales: number;
}
