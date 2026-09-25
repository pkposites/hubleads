"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { channelLabel } from "@/lib/attribution";
import { formatDateTime, formatMoney, formatPhone, timeSince } from "@/lib/format";
import { whatsappDigits } from "@/lib/normalize";
import { adNames, answerEntries, answerLabel, STATUSES, type Lead, type Status } from "@/lib/leads";
import { deleteLeads, updateLeadField, type EditableField } from "../actions";

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
        className={`${className} rounded border border-transparent bg-transparent px-1.5 py-1 text-base hover:border-zinc-300 md:text-sm focus:border-zinc-900 focus:bg-white focus:outline-none ${
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
        className={`rounded px-2 py-1.5 text-base font-medium md:py-1 md:text-sm ${STATUS_STYLE[status]}`}
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

function AdCell({ name, id }: { name: string | null; id: string | null }) {
  return (
    <td className="max-w-48 px-2 py-1.5 text-xs">
      <div className="break-words">{muted(name)}</div>
      {id && <div className="font-mono text-zinc-500">#{id}</div>}
    </td>
  );
}

/** Phones: one card per lead, editable fields first, origin behind a tap. */
function LeadCard({
  slug,
  lead,
  selectable,
  selected,
  onToggle,
}: {
  slug: string;
  lead: Lead;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const names = adNames(lead);
  const answers = answerEntries(lead.extra);
  const wa = whatsappDigits(lead.phone);
  const moneyDisplay = (v: unknown) =>
    v === null || v === undefined || v === "" ? "" : formatMoney(v as number).replace(/\u00a0/g, " ");
  return (
    <li className={`rounded-lg border bg-white p-3 ${selected ? "border-red-300 bg-red-50/50" : "border-zinc-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {selectable && (
            <input type="checkbox" className="size-5" aria-label={`Selecionar ${lead.code}`} checked={selected} onChange={onToggle} />
          )}
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-white">{lead.code}</span>
          <span className="text-xs text-zinc-500">
            {formatDateTime(lead.created_at)} · {timeSince(lead.created_at)}
          </span>
        </div>
        <span className="shrink-0 text-xs text-zinc-600">{channelLabel(lead.channel)}</span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <TextCell slug={slug} lead={lead} field="name" placeholder="Nome" className="w-full" />
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <TextCell
              slug={slug}
              lead={lead}
              field="phone"
              placeholder="Preencher telefone"
              display={(v) => (v ? formatPhone(String(v)) : "")}
              className="w-full"
            />
          </div>
          {wa && (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
            >
              Abrir WhatsApp
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatusCell slug={slug} lead={lead} />
          <TextCell slug={slug} lead={lead} field="sale_value" placeholder="Valor R$" display={moneyDisplay} className="w-full" />
        </div>
        <TextCell slug={slug} lead={lead} field="notes" placeholder="Anotar observação" className="w-full" />
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-1 text-zinc-600">Origem e respostas</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {[
            ["Campanha", names.campaign],
            ["Conjunto", names.adset],
            ["Anúncio", names.ad],
            ["Fonte", [lead.utm_source, lead.utm_medium].filter(Boolean).join(" / ")],
            ["Página", lead.landing_url],
            ["Dispositivo", lead.device],
            ["Cliques", String(lead.clicks)],
            ...answers.map(([k, v]) => [answerLabel(k), v]),
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
        </dl>
      </details>
    </li>
  );
}

/** Confirmation step before rows are deleted for good. */
function DeleteDialog({
  leads,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  leads: Lead[];
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-t-xl bg-white p-5 shadow-xl sm:rounded-lg">
        <h2 className="text-base font-semibold">
          Excluir {leads.length} {leads.length === 1 ? "linha" : "linhas"}?
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Esta ação não pode ser desfeita. As visitas e cliques dessas linhas também saem dos indicadores.
        </p>
        <ul className="mt-3 max-h-40 overflow-auto rounded border border-zinc-200 text-sm">
          {leads.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 border-b border-zinc-100 px-3 py-1.5 last:border-0">
              <span>
                <span className="font-mono text-xs">{l.code}</span> {l.name ?? "Sem nome"}
              </span>
              <span className="text-xs text-zinc-500">{formatDateTime(l.created_at)}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "Excluindo..." : "Excluir definitivamente"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LeadSheet({ slug, leads, canDelete = false }: { slug: string; leads: Lead[]; canDelete?: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const visibleSelected = leads.filter((l) => selected.has(l.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = leads.length > 0 && visibleSelected.length === leads.length;

  const moneyDisplay = (v: unknown) =>
    v === null || v === undefined || v === "" ? "" : formatMoney(v as number).replace(/ /g, " ");
  const phoneDisplay = (v: unknown) => (v ? formatPhone(String(v)) : "");

  return (
    <div className="flex flex-col gap-2">
      {canDelete && visibleSelected.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">
          <span>
            {visibleSelected.length} {visibleSelected.length === 1 ? "linha selecionada" : "linhas selecionadas"}
          </span>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Excluir linhas
          </Button>
          <button className="text-zinc-600 hover:underline" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}
      {confirming && (
        <DeleteDialog
          leads={visibleSelected}
          pending={deleting}
          error={deleteError}
          onCancel={() => {
            setConfirming(false);
            setDeleteError(null);
          }}
          onConfirm={() =>
            startDelete(async () => {
              const result = await deleteLeads(slug, visibleSelected.map((l) => l.id));
              if (result.error) {
                setDeleteError(result.error);
              } else {
                setConfirming(false);
                setSelected(new Set());
              }
            })
          }
        />
      )}
      <ul className="flex flex-col gap-2 md:hidden">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            slug={slug}
            lead={lead}
            selectable={canDelete}
            selected={selected.has(lead.id)}
            onToggle={() => toggle(lead.id)}
          />
        ))}
      </ul>
    <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block">
      <table className="w-full min-w-[1900px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr className="border-b border-zinc-200">
            {canDelete && (
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Selecionar todas"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))}
                />
              </th>
            )}
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
              "Conjunto",
              "Anúncio",
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
            <tr key={lead.id} className={`align-top hover:bg-zinc-50/60 ${selected.has(lead.id) ? "bg-red-50/60" : ""}`}>
              {canDelete && (
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${lead.code}`}
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                  />
                </td>
              )}
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
              <td className="max-w-48 px-2 py-1.5 text-xs">
                <div className="break-words">{muted(adNames(lead).campaign)}</div>
                {lead.campaign_id && <div className="font-mono text-zinc-500">#{lead.campaign_id}</div>}
                <div className="text-zinc-500">
                  {lead.utm_source}
                  {lead.utm_medium && ` / ${lead.utm_medium}`}
                </div>
              </td>
              <AdCell name={adNames(lead).adset} id={lead.adset_id} />
              <AdCell name={adNames(lead).ad} id={lead.ad_id} />
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
    </div>
  );
}
