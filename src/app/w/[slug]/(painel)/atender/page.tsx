import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { call } from "@/lib/db";
import { type Lead, type Queue } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { LeadCard } from "../lead-sheet";

function Section({
  title,
  hint,
  leads,
  tone,
  lpEvents,
}: {
  title: string;
  hint: string;
  leads: Lead[];
  tone: string;
  lpEvents: Record<string, string[]>;
}) {
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
          <LeadCard key={lead.id} lead={lead} lpEvents={lpEvents[lead.id]} />
        ))}
      </ul>
    </section>
  );
}

/** Follow-ups scheduled on the leads (the sheet is the main page). */
export default async function FollowUpsPage({ params }: PageProps<"/w/[slug]/atender">) {
  const { slug } = await params;
  const { token } = await requireWorkspace(slug);
  const queue = await call<Queue>("lh_queue", { p_token: token });
  const ids = [...queue.overdue, ...queue.today].map((l) => l.id);
  const lpEvents = ids.length ? await call<Record<string, string[]>>("lh_lead_lp_events", { p_token: token, p_lead_ids: ids }) : {};

  if (ids.length === 0) {
    return (
      <EmptyState title="Nenhum retorno para hoje">
        Ao agendar um retorno num lead da planilha, ele aparece aqui no dia marcado.{" "}
        <Link href={`/w/${slug}`} className="underline">
          Ver a planilha
        </Link>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Section title="Retornos atrasados" hint="A data do retorno já passou." leads={queue.overdue} tone="bg-red-100 text-red-800" lpEvents={lpEvents} />
      <Section title="Retornos de hoje" hint="Agendados para hoje." leads={queue.today} tone="bg-violet-100 text-violet-800" lpEvents={lpEvents} />
    </div>
  );
}
