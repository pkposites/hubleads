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
  pages: Page[];
}

export const currentAdmin = cache(async (): Promise<{ token: string; login: string } | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const admin = await call<{ login: string }>("lh_admin_session", { p_token: token });
    return { token, login: admin.login };
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

/** Public URL of this app, used in the snippet and in the access links. */
export async function appOrigin() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export function snippet(origin: string, page: Pick<Page, "public_key">) {
  return `<script src="${origin}/tracker.js" data-key="${page.public_key}" async></script>`;
}

/** Instructions to paste into the landing page's Claude Code (or hand to its developer). */
export function installPrompt(origin: string, page: Pick<Page, "public_key">) {
  return `Quero conectar esta landing page ao Lead Hub, que registra cada contato pelo WhatsApp numa planilha com a origem do anúncio.

1. Adicione este script em todas as páginas, dentro do <head>, logo depois do pixel da Meta. Não altere o pixel nem os scripts atuais de UTMs e eventos:

${snippet(origin, page)}

2. Em TODOS os botões de contato/WhatsApp, antes de abrir o WhatsApp, mostre um passo curto pedindo:
   - Nome (obrigatório)
   - WhatsApp com DDD (obrigatório, com máscara (11) 91234-5678)
   Abaixo do botão, inclua: "Ao continuar, você concorda em ser contatado pelo WhatsApp."

3. Ao confirmar esse passo:
     window.LeadHub?.identify({ name: nome, phone: telefone });
   e abra o WhatsApp passando a URL pelo Lead Hub:
     const destino = window.LeadHub ? window.LeadHub.whatsappUrl(url) : url;
   Use "destino" no lugar da URL original, do jeito que a página já abre hoje (link, window.open ou location.href).

4. Se a página tiver quiz ou perguntas, envie as respostas antes de abrir o WhatsApp:
     window.LeadHub?.set({ "Pergunta curta": "resposta escolhida" });
   Use rótulos curtos em português como chave (viram colunas na planilha) e o texto da opção como valor.

5. Não mexa no pixel da Meta nem na Conversions API. No final, liste os botões alterados e como cada um abre o WhatsApp.

Para testar: abra a página com ?utm_source=teste, preencha nome e telefone e clique no WhatsApp. A mensagem deve terminar com "(cód. XXXX)" e o contato aparece na planilha do Lead Hub.`;
}
