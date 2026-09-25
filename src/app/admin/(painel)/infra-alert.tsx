import { formatMb, type InfraStatus, type InfraNumbers } from "@/lib/infra";

const STYLE = {
  ok: "border-zinc-200 bg-white",
  atencao: "border-amber-300 bg-amber-50",
  trocar: "border-red-300 bg-red-50",
} as const;

const TITLE = {
  ok: "Banco de dados: tudo certo por enquanto",
  atencao: "Banco de dados: comece a planejar a mudança para um projeto próprio",
  trocar: "Banco de dados: hora de mudar o Lead Hub para um projeto Supabase próprio",
} as const;

/** Tells the admin when to move Lead Hub out of the shared Supabase project. */
export function InfraAlert({ status, numbers }: { status: InfraStatus; numbers: InfraNumbers }) {
  if (status.level === "ok" && !status.shared) return null;
  return (
    <section className={`rounded-lg border p-4 text-sm ${STYLE[status.level]}`} role={status.level === "ok" ? undefined : "alert"}>
      <h2 className="font-semibold">{TITLE[status.level]}</h2>
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
    </section>
  );
}
