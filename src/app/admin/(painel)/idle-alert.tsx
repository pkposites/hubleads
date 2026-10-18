import Link from "next/link";
import { DismissibleAlert, type AlertMode } from "@/components/dismissible-alert";
import { formatDateTime } from "@/lib/format";
import { alertSignature, formatIdle, type IdleClient } from "@/lib/client-alerts";

const SHOWN = 5;

/** Clients whose last lead is more than 20 h old: a campaign may have stopped. */
export function IdleAlert({ clients, mode }: { clients: IdleClient[]; mode: (signature: string) => AlertMode }) {
  if (clients.length === 0) return null;
  // Comes back when the list changes (another client, or a new lead and then silence again).
  const signature = alertSignature(clients.map((c) => [c.id, c.lastLeadAt]));
  const title =
    clients.length === 1 ? `${clients[0].name} está sem lead novo há mais de 20 h` : `${clients.length} clientes sem lead novo há mais de 20 h`;
  return (
    <DismissibleAlert id="parados" signature={signature} initialMode={mode(signature)} tone="amber" title={title}>
      <ul className="mt-2 flex flex-col gap-1">
        {clients.slice(0, SHOWN).map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline">
              {c.name}
            </Link>
            <span className="text-xs text-zinc-600">
              {c.lastLeadAt ? `último lead há ${formatIdle(c.hours)} (${formatDateTime(c.lastLeadAt)})` : `nenhum lead desde a criação (${formatIdle(c.hours)})`}
            </span>
          </li>
        ))}
      </ul>
      {clients.length > SHOWN && <p className="mt-1 text-xs text-zinc-600">e mais {clients.length - SHOWN} (veja na lista de clientes abaixo).</p>}
      <p className="mt-2 text-xs text-zinc-600">
        Vale conferir se a campanha está ativa e com orçamento, se a LP ou a planilha continuam enviando e se o formulário da Meta está
        publicado. Se a pausa for de propósito, oculte este aviso: ele volta sozinho se a situação mudar.
      </p>
    </DismissibleAlert>
  );
}
