import { DismissibleAlert, type AlertMode } from "@/components/dismissible-alert";
import { formatMb, type InfraStatus, type InfraNumbers } from "@/lib/infra";

const TONE = { ok: "neutral", atencao: "amber", trocar: "red" } as const;

const TITLE = {
  ok: "Banco de dados: tudo certo por enquanto",
  atencao: "Banco de dados: comece a planejar a mudança para um projeto próprio",
  trocar: "Banco de dados: hora de mudar o Lead Hub para um projeto Supabase próprio",
} as const;

/** Tells the admin when to move Lead Hub out of the shared Supabase project. */
export function InfraAlert({
  status,
  numbers,
  mode,
}: {
  status: InfraStatus;
  numbers: InfraNumbers;
  /** Minimised or hidden by the admin (until the level changes). */
  mode: (signature: string) => AlertMode;
}) {
  if (status.level === "ok" && !status.shared) return null;
  const signature = `${status.level}-${status.shared ? "s" : "p"}`;
  return (
    <DismissibleAlert id="banco" signature={signature} initialMode={mode(signature)} tone={TONE[status.level]} title={TITLE[status.level]}>
      {status.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {status.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {status.shared && (
        <p className="mt-2 text-zinc-700">
          {status.level === "ok"
            ? "O Lead Hub divide o banco com outro sistema. Hoje não há risco imediato, e este aviso muda de cor quando chegar a hora de migrar."
            : "Enquanto o banco for compartilhado, um backup restaurado, uma troca de chaves ou um erro no outro sistema também afeta os leads. A migração leva cerca de 1 hora e não mexe nas LPs."}
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Banco: {formatMb(numbers.db_bytes)} ({status.dbPercent}% do limite) · Lead Hub: {formatMb(numbers.lh_bytes)} ·{" "}
        {numbers.clients} {numbers.clients === 1 ? "cliente" : "clientes"} · {numbers.leads.toLocaleString("pt-BR")} leads ·{" "}
        {numbers.events_7d.toLocaleString("pt-BR")} eventos nos últimos 7 dias
        {status.daysToLimit !== null && status.daysToLimit < 3650 ? ` · espaço para ~${status.daysToLimit} dias` : ""}
        {status.shared
          ? ` · ${numbers.other_tables} ${numbers.other_tables === 1 ? "tabela" : "tabelas"} de outro sistema no mesmo banco`
          : ""}
      </p>
    </DismissibleAlert>
  );
}
