import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { call, DbError } from "@/lib/db";
import type { Page } from "@/lib/leads";

export const ADMIN_COOKIE = "lh_admin";

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  leads_total: number;
  leads_7d: number;
  without_phone: number;
  last_lead_at: string | null;
  last_event_at: string | null;
  owner_admin_id: string | null;
  owner_login: string | null;
  pages: Page[];
}

export type AdminRole = "master" | "gestor";

export interface AdminUser {
  id: string;
  login: string;
  role: AdminRole;
  active: boolean;
  created_at: string;
  clients: number;
  last_login_at: string | null;
}

export const currentAdmin = cache(async (): Promise<{ token: string; login: string; role: AdminRole } | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const admin = await call<{ login: string; role: AdminRole }>("lh_admin_session", { p_token: token });
    return { token, login: admin.login, role: admin.role };
  } catch (error) {
    if (error instanceof DbError && error.code === "LH401") return null;
    throw error;
  }
});

export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/entrar");
  return admin;
}

/** Master-only pages (managing gestores). Gestores go back to their clients. */
export async function requireMaster() {
  const admin = await requireAdmin();
  if (admin.role !== "master") redirect("/admin");
  return admin;
}

/** Public URL of this app, used in the snippet and in the access links. */
export async function appOrigin() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export function snippet(origin: string, page: Pick<Page, "public_key">) {
  return `<script src="${origin}/tracker.js" data-key="${page.public_key}" data-consent="banner" async></script>`;
}

/** Instructions to paste into the landing page's Claude Code (or hand to its developer). */
export function installPrompt(origin: string, page: Pick<Page, "public_key">) {
  const policy = `${origin}/privacidade/${page.public_key}`;
  return `Quero conectar esta landing page ao Lead Hub, que registra cada contato pelo WhatsApp numa planilha com a origem do anúncio, respeitando a LGPD.

1. Adicione este script em todas as páginas, dentro do <head>, logo depois do pixel da Meta. Não altere os scripts atuais de UTMs e eventos:

${snippet(origin, page)}

   O data-consent="banner" mostra um aviso curto de cookies (Aceitar/Recusar). Sem aceite, nada de navegação é guardado nem enviado.
   Se a página já tiver um banner de cookies próprio, troque por data-consent="required" e chame window.LeadHub?.consent(true) ao aceitar e window.LeadHub?.consent(false) ao recusar (não mostre os dois banners).

2. LGPD no pixel da Meta e no Google: para que também só rodem depois do aceite, no código do pixel coloque fbq('consent', 'revoke'); ANTES de fbq('init', ...). Se houver Google Tag Manager/gtag, antes dele: gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });. O Lead Hub libera os dois quando a pessoa aceita. Não mude mais nada no pixel.

3. Em TODOS os botões de contato/WhatsApp, antes de abrir o WhatsApp, mostre um passo curto pedindo:
   - Nome (obrigatório)
   - WhatsApp com DDD (obrigatório, com máscara (11) 91234-5678)
   Abaixo do botão, inclua: "Ao continuar, você concorda em ser contatado pelo WhatsApp. Veja a Política de privacidade." com o link ${policy}
   Coloque o mesmo link no rodapé da página.

4. Ao confirmar esse passo:
     window.LeadHub?.identify({ name: nome, phone: telefone });
   e abra o WhatsApp passando a URL pelo Lead Hub:
     const destino = window.LeadHub ? window.LeadHub.whatsappUrl(url) : url;
   Use "destino" no lugar da URL original, do jeito que a página já abre hoje (link, window.open ou location.href).

5. Se a página tiver quiz ou perguntas, envie as respostas antes de abrir o WhatsApp:
     window.LeadHub?.set({ "Pergunta curta": "resposta escolhida" });
   Use rótulos curtos em português como chave (viram colunas na planilha) e o texto da opção como valor.
   Se alguma pergunta for sobre saúde (sintomas, tratamentos, condições), inclua antes do envio uma caixa de seleção, desmarcada, obrigatória para enviar essas respostas: "Autorizo o uso das minhas respostas sobre saúde somente para o meu atendimento." Sem a marcação, não chame LeadHub.set com essas respostas.

6. Não mexa na Conversions API. No final, liste os botões alterados, como cada um abre o WhatsApp e onde ficou o link da política.

Para testar: abra a página com ?utm_source=teste, aceite os cookies, preencha nome e telefone e clique no WhatsApp. A mensagem deve terminar com "(cód. XXXX)" e o contato aparece na planilha do Lead Hub. Em outra janela anônima, recuse os cookies: o contato ainda aparece, mas com a origem "não coletada".`;
}
