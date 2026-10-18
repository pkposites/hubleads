import { formatDateTime } from "@/lib/format";
import { markSignup } from "../actions";

export interface Signup {
  id: string;
  name: string;
  company: string;
  whatsapp: string;
  email: string | null;
  profile: "agencia" | "negocio" | "outro" | null;
  channels: string[];
  message: string | null;
  contacted_at: string | null;
  created_at: string;
}

const PROFILE = { agencia: "Agência / gestor", negocio: "Dono do negócio", outro: "Outro" } as const;
const CHANNEL: Record<string, string> = {
  lp: "Landing page",
  meta_form: "Formulário Meta",
  google: "Google Ads",
  sheets: "Planilha",
  whatsapp_direto: "Direto p/ WhatsApp",
  nao_anuncia: "Não anuncia",
};

/** Requests left on the home page ("Quero usar"), for the master to call back. */
export function Signups({ signups }: { signups: Signup[] }) {
  if (signups.length === 0) return null;
  const pending = signups.filter((s) => !s.contacted_at);
  return (
    <details open={pending.length > 0} className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-emerald-900">
        Pedidos de cadastro pela página inicial
        {pending.length > 0 ? ` · ${pending.length} ${pending.length === 1 ? "novo" : "novos"}` : ""}
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {signups.slice(0, 20).map((s) => {
          const digits = s.whatsapp.replace(/\D/g, "");
          const phone = digits.length <= 11 ? `55${digits}` : digits;
          return (
            <li key={s.id} className={`rounded-lg border bg-white p-3 ${s.contacted_at ? "border-zinc-200 opacity-60" : "border-emerald-200"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium">
                  {s.name} · <span className="text-zinc-600">{s.company}</span>
                </p>
                <span className="text-xs text-zinc-500">{formatDateTime(s.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                {s.profile ? PROFILE[s.profile] : ""}
                {s.channels.length > 0 ? ` · ${s.channels.map((c) => CHANNEL[c] ?? c).join(", ")}` : ""}
                {s.email ? ` · ${s.email}` : ""}
              </p>
              {s.message && <p className="mt-1 text-xs text-zinc-700">“{s.message}”</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <a
                  href={`https://wa.me/${phone}?text=${encodeURIComponent(`Olá, ${s.name.split(" ")[0]}! Aqui é do Cadê o Lead, recebemos seu pedido.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-emerald-600 px-3 py-1 font-medium text-white"
                >
                  Chamar no WhatsApp
                </a>
                <form action={markSignup.bind(null, s.id, !s.contacted_at)}>
                  <button className="text-zinc-600 hover:underline">{s.contacted_at ? "Voltar para novo" : "Marcar como contatado"}</button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
