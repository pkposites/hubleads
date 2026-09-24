"use client";

import { useState, useTransition } from "react";
import { channelLabel } from "@/lib/attribution";
import { formatDateTime, formatMoney, formatPhone, timeSince } from "@/lib/format";
import { answerEntries, answerLabel, STATUSES, type Lead, type Status } from "@/lib/leads";
import { updateLeadField, type EditableField } from "../actions";

const STATUS_STYLE: Record<Status, string> = {
  novo: "bg-sky-50 text-sky-800",
  em_atendimento: "bg-amber-50 text-amber-800",
  agendado: "bg-violet-50 text-violet-800",
  venda: "bg-emerald-50 text-emerald-800",
  perdido: "bg-zinc-100 text-zinc-600",
};

function useSave(slug: string, leadId: string, field: EditableField) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (raw: string, onSaved: (value: unknown) => void, onFail: () => void) =>
    start(async () => {
      const result = await updateLeadField(slug, leadId, field, raw);
      if (result.error) {
        setError(result.error);
        onFail();
      } else {
        setError(null);
        onSaved(result.value);
      }
    });
  return { pending, error, save };
}

function TextCell({
  slug,
  lead,
  field,
  placeholder,
  display,
  className = "w-40",
}: {
  slug: string;
  lead: Lead;
  field: "name" | "phone" | "notes" | "sale_value";
  placeholder: string;
  display?: (value: unknown) => string;
  className?: string;
}) {
  const format = display ?? ((v: unknown) => (v === null || v === undefined ? "" : String(v)));
  const [saved, setSaved] = useState(format(lead[field]));
  const [value, setValue] = useState(saved);
  const { pending, error, save } = useSave(slug, lead.id, field);

  const commit = () => {
    if (value.trim() === saved.trim()) return;
    save(
      value,
      (stored) => {
        const text = format(stored);
        setSaved(text);
        setValue(text);
      },
      () => setValue(saved),
    );
  };

  return (
    <div className="flex flex-col">
      <input
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setValue(saved);
        }}
        className={`${className} rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-zinc-300 focus:border-zinc-900 focus:bg-white focus:outline-none ${
          pending ? "opacity-60" : ""
        } ${field === "phone" && !value ? "border-dashed border-amber-300 bg-amber-50/60" : ""}`}
      />
      {error && <span className="px-1.5 text-xs text-red-700">{error}</span>}
    </div>
  );
}

function StatusCell({ slug, lead }: { slug: string; lead: Lead }) {
  const [status, setStatus] = useState<Status>(lead.status);
  const { pending, error, save } = useSave(slug, lead.id, "status");
  return (
    <div className="flex flex-col">
      <select
        aria-label="Status"
        value={status}
        disabled={pending}
        onChange={(e) => {
          const previous = status;
          const next = e.target.value as Status;
          setStatus(next);
          save(next, () => undefined, () => setStatus(previous));
        }}
        className={`rounded px-2 py-1 text-sm font-medium ${STATUS_STYLE[status]}`}
      >
        {Object.entries(STATUSES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

const path = (url: string | null) => {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.hostname : u.pathname;
  } catch {
    return url;
  }
};

const muted = (v: string | null | undefined) => v || <span className="text-zinc-300">—</span>;

export function LeadSheet({ slug, leads }: { slug: string; leads: Lead[] }) {
  const moneyDisplay = (v: unknown) =>
    v === null || v === undefined || v === "" ? "" : formatMoney(v as number).replace(/ /g, " ");
  const phoneDisplay = (v: unknown) => (v ? formatPhone(String(v)) : "");

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[1800px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr className="border-b border-zinc-200">
            {[
              "Clique",
              "Cód.",
              "Nome",
              "Telefone",
              "Status",
              "Valor",
              "Respostas",
              "Origem",
              "Campanha",
              "Conteúdo / anúncio",
              "Termo",
              "Página",
              "Dispositivo",
              "Cliques",
              "Observações",
            ].map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {leads.map((lead) => (
            <tr key={lead.id} className="align-top hover:bg-zinc-50/60">
              <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                <div>{formatDateTime(lead.created_at)}</div>
                <div className="text-zinc-500">{timeSince(lead.created_at)}</div>
              </td>
              <td className="px-2 py-1.5">
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-white">{lead.code}</span>
              </td>
              <td className="px-1 py-0.5">
                <TextCell slug={slug} lead={lead} field="name" placeholder="Nome" />
              </td>
              <td className="px-1 py-0.5">
                <TextCell slug={slug} lead={lead} field="phone" placeholder="Preencher" display={phoneDisplay} />
              </td>
              <td className="px-2 py-1">
                <StatusCell slug={slug} lead={lead} />
              </td>
              <td className="px-1 py-0.5">
                <TextCell slug={slug} lead={lead} field="sale_value" placeholder="R$" display={moneyDisplay} className="w-28" />
              </td>
              <td className="min-w-48 max-w-72 px-2 py-1.5 text-xs">
                {answerEntries(lead.extra).length === 0 ? (
                  <span className="text-zinc-300">—</span>
                ) : (
                  <dl className="space-y-0.5">
                    {answerEntries(lead.extra).map(([key, value]) => (
                      <div key={key}>
                        <dt className="inline text-zinc-500">{answerLabel(key)}: </dt>
                        <dd className="inline">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{channelLabel(lead.channel)}</td>
              <td className="px-2 py-1.5 text-xs">
                <div>{muted(lead.utm_campaign)}</div>
                <div className="text-zinc-500">
                  {lead.utm_source}
                  {lead.utm_medium && ` / ${lead.utm_medium}`}
                </div>
              </td>
              <td className="px-2 py-1.5 text-xs">
                <div>{muted(lead.utm_content)}</div>
                {lead.ad_id && <div className="font-mono text-zinc-500">#{lead.ad_id}</div>}
              </td>
              <td className="px-2 py-1.5 text-xs">{muted(lead.utm_term)}</td>
              <td className="max-w-40 truncate px-2 py-1.5 text-xs" title={lead.landing_url ?? undefined}>
                {path(lead.landing_url)}
              </td>
              <td className="px-2 py-1.5 text-xs">{muted(lead.device)}</td>
              <td className="px-2 py-1.5 text-center">{lead.clicks}</td>
              <td className="px-1 py-0.5">
                <TextCell slug={slug} lead={lead} field="notes" placeholder="Anotar" className="w-56" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
