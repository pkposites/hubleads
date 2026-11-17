import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { allowOrigin, dismissOrigin } from "../actions";

export interface OriginAlert {
  workspace_id: string;
  workspace_name: string;
  page_id: string;
  page_name: string;
  host: string;
  events: number;
  leads: number;
  first_at: string;
  last_at: string;
}

/**
 * Sends refused because the site's address is not among the page's domains:
 * every contact from that address is being lost until it is allowed.
 */
export function OriginAlerts({ alerts, showClient }: { alerts: OriginAlert[]; showClient: boolean }) {
  if (alerts.length === 0) return null;
  const lost = alerts.reduce((n, a) => n + a.leads, 0);
  return (
    <section role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950">
      <h2 className="font-semibold">
        {lost > 0
          ? `${lost} contato${lost === 1 ? "" : "s"} recusado${lost === 1 ? "" : "s"}: site em endereço não cadastrado`
          : "Envios recusados: site em endereço não cadastrado"}
      </h2>
      <p className="mt-1 text-red-900">
        O Cadê o Lead só aceita envios dos domínios cadastrados na página. Enquanto o endereço abaixo não for liberado, as visitas e os
        contatos que vêm dele são descartados.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {alerts.map((a) => (
          <li key={`${a.page_id}:${a.host}`} className="rounded-lg border border-red-200 bg-white px-3 py-2.5">
            <p>
              {showClient && (
                <>
                  <Link href={`/admin/clientes/${a.workspace_id}?aba=fontes`} className="font-medium hover:underline">
                    {a.workspace_name}
                  </Link>{" "}
                  ·{" "}
                </>
              )}
              página {a.page_name}: <strong className="break-all">{a.host}</strong>
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">
              {a.leads > 0 ? `${a.leads} contato${a.leads === 1 ? "" : "s"} e ` : ""}
              {a.events} envio{a.events === 1 ? "" : "s"} recusado{a.events === 1 ? "" : "s"} desde {formatDateTime(a.first_at)} · último{" "}
              {formatDateTime(a.last_at)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={allowOrigin.bind(null, a.workspace_id, a.page_id, a.host)}>
                <button className="min-h-9 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">Liberar este endereço</button>
              </form>
              <form action={dismissOrigin.bind(null, a.workspace_id, a.page_id, a.host)}>
                <button className="min-h-9 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700">
                  Não é deste cliente
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-red-900">
        Libere só endereços do próprio cliente. &quot;Não é deste cliente&quot; esconde o aviso; ele volta se um contato for recusado de novo.
      </p>
    </section>
  );
}
