import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { call } from "@/lib/db";
import { formatMinutes, periodStart, rate, formatRate, type AttendanceMetrics, type Lead, type Queue } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { LeadCard } from "../lead-sheet";

function Section({ title, hint, leads, waiting = false, tone }: { title: string; hint: string; leads: Lead[]; waiting?: boolean; tone: string }) {
  if (leads.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className={`rounded-full px-2 text-xs font-semibold tabular-nums ${tone}`}>{leads.length}</span>
        <span className="hidden text-xs text-zinc-500 sm:inline">{hint}</span>
      </div>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} waiting={waiting} />
        ))}
      </ul>
    </section>
  );
}

export default async function QueuePage({ params }: PageProps<"/w/[slug]/atender">) {
  const { slug } = await params;
  const { token } = await requireWorkspace(slug);
  const [queue, today] = await Promise.all([
    call<Queue>("lh_queue", { p_token: token }),
    call<AttendanceMetrics>("lh_attendance_metrics", { p_token: token, p_since: periodStart("hoje")?.toISOString() }),
  ]);
  const empty = queue.waiting.length + queue.overdue.length + queue.today.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:max-w-2xl">
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
          <div className="text-xs text-zinc-500">Aguardando</div>
          <div className="text-xl font-semibold tabular-nums">{queue.waiting.length}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
          <div className="text-xs text-zinc-500">1º contato hoje</div>
          <div className="text-xl font-semibold tabular-nums">{formatMinutes(today.first_contact_median_min)}</div>
          <div className="text-xs text-zinc-500">mediana</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
          <div className="text-xs text-zinc-500">Em até 5 min</div>
          <div className="text-xl font-semibold tabular-nums">{formatRate(rate(today.within_5_min, today.contacted))}</div>
          <div className="text-xs text-zinc-500">{today.contacted} atendidos hoje</div>
        </div>
      </div>

      {empty ? (
        <EmptyState title="Ninguém esperando agora">
          Novos cliques no WhatsApp aparecem aqui em segundos. Retornos agendados também entram na fila no dia marcado.{" "}
          <Link href={`/w/${slug}`} className="underline">
            Ver a planilha
          </Link>
        </EmptyState>
      ) : (
        <>
          <Section
            title="Aguardando primeiro contato"
            hint="Os mais antigos primeiro. Toque em WhatsApp para responder com uma mensagem pronta."
            leads={queue.waiting}
            waiting
            tone="bg-red-600 text-white"
          />
          <Section title="Retornos atrasados" hint="A data do retorno já passou." leads={queue.overdue} tone="bg-red-100 text-red-800" />
          <Section title="Retornos de hoje" hint="Agendados para mais tarde hoje." leads={queue.today} tone="bg-violet-100 text-violet-800" />
        </>
      )}
    </div>
  );
}
