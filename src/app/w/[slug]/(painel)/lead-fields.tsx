"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { formatDateTime, formatMoney, formatPhone, formatWhen, localAt, toLocalInput } from "@/lib/format";
import { fillTemplate, formatMinutes, LOST_REASONS, STATUSES, type HistoryEntry, type Lead, type Status } from "@/lib/leads";
import { whatsappDigits } from "@/lib/normalize";
import { leadHistory, logContact, setLeadStatus, updateLeadField, type EditableField } from "../actions";
import { BottomSheet } from "./bottom-sheet";
import { usePanel } from "./panel-context";

export const STATUS_STYLE: Record<Status, string> = {
  novo: "bg-sky-50 text-sky-800",
  em_atendimento: "bg-amber-50 text-amber-800",
  agendado: "bg-violet-50 text-violet-800",
  venda: "bg-emerald-50 text-emerald-800",
  perdido: "bg-zinc-100 text-zinc-600",
};

/** Keeps local state in step with fresh server data (after a refresh). */
function useSynced<T>(value: T) {
  const [state, setState] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setState(value);
  }
  return [state, setState] as const;
}

function useSave(leadId: string, field: EditableField) {
  const { slug } = usePanel();
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

export const moneyDisplay = (v: unknown) =>
  v === null || v === undefined || v === "" ? "" : formatMoney(v as number).replace(/ /g, " ");
export const phoneDisplay = (v: unknown) => (v ? formatPhone(String(v)) : "");

export function TextCell({
  lead,
  field,
  placeholder,
  display,
  className = "w-40",
}: {
  lead: Lead;
  field: "name" | "phone" | "notes" | "sale_value";
  placeholder: string;
  display?: (value: unknown) => string;
  className?: string;
}) {
  const format = display ?? ((v: unknown) => (v === null || v === undefined ? "" : String(v)));
  const [saved, setSaved] = useSynced(format(lead[field]));
  const [value, setValue] = useSynced(saved);
  const { pending, error, save } = useSave(lead.id, field);

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

function LostReasonDialog({ onCancel, onConfirm, pending, error }: { onCancel: () => void; onConfirm: (reason: string) => void; pending: boolean; error: string | null }) {
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  const reason = choice === "Outro" ? other.trim() : choice;
  return (
    <BottomSheet title="Por que o lead foi perdido?" onClose={onCancel}>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {[...LOST_REASONS, "Outro"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setChoice(r)}
              aria-pressed={choice === r}
              className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm ${
                choice === r ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {choice === "Outro" && (
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Qual motivo?" maxLength={200} className={inputClass} />
        )}
        <p className="text-xs text-zinc-500">O motivo aparece nas métricas e ajuda a entender o que melhorar.</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(reason)} disabled={!reason || pending}>
            {pending ? "Salvando..." : "Marcar como perdido"}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

export function StatusCell({ lead }: { lead: Lead }) {
  const { slug } = usePanel();
  const [status, setStatus] = useSynced<Status>(lead.status);
  const [reason, setReason] = useSynced(lead.lost_reason);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (next: Status, lostReason?: string) => {
    const previous = status;
    setStatus(next);
    start(async () => {
      const result = await setLeadStatus(slug, lead.id, next, lostReason);
      if (result.error) {
        setError(result.error);
        setStatus(previous);
      } else {
        setError(null);
        setAsking(false);
        setReason(result.lead?.lost_reason ?? null);
      }
    });
  };

  return (
    <div className="flex flex-col">
      <select
        aria-label="Status"
        value={status}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Status;
          if (next === "perdido") setAsking(true);
          else apply(next);
        }}
        className={`rounded px-2 py-1.5 text-base font-medium md:py-1 md:text-sm ${STATUS_STYLE[status]}`}
      >
        {Object.entries(STATUSES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {status === "perdido" && reason && <span className="px-1 pt-0.5 text-xs text-zinc-500">Motivo: {reason}</span>}
      {error && !asking && <span className="text-xs text-red-700">{error}</span>}
      {asking && (
        <LostReasonDialog
          pending={pending}
          error={error}
          onCancel={() => {
            setAsking(false);
            setError(null);
          }}
          onConfirm={(r) => apply("perdido", r)}
        />
      )}
    </div>
  );
}

/** Next follow-up date; red when overdue. */
export function NextContactCell({ lead, className = "" }: { lead: Lead; className?: string }) {
  const [value, setValue] = useSynced(lead.next_contact_at);
  const { pending, error, save } = useSave(lead.id, "next_contact_at");
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const overdue = value && now !== null && new Date(value).getTime() < now;

  const commit = (local: string) => {
    setEditing(false);
    if (local === toLocalInput(value)) return;
    const previous = value;
    save(local, (stored) => setValue((stored as string | null) ?? null), () => setValue(previous));
  };

  const preset = (days: number, hour: number) => commit(localAt(days, hour));

  if (!editing) {
    return (
      <div className={`flex flex-col ${className}`}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className={`min-h-9 rounded border px-2 py-1 text-left text-sm ${
            value
              ? overdue
                ? "border-red-200 bg-red-50 font-medium text-red-800"
                : "border-violet-200 bg-violet-50 text-violet-900"
              : "border-dashed border-zinc-300 text-zinc-500"
          }`}
        >
          {value ? `${overdue ? "Atrasado · " : ""}Retorno ${formatWhen(value)}` : "+ Agendar retorno"}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    );
  }
  return (
    <div className={`flex flex-col gap-1.5 rounded border border-zinc-300 bg-white p-2 ${className}`}>
      <div className="flex flex-wrap gap-1">
        {[
          ["Hoje 17h", 0, 17],
          ["Amanhã 9h", 1, 9],
          ["Em 3 dias", 3, 9],
          ["Em 7 dias", 7, 9],
        ].map(([label, days, hour]) => (
          <button
            key={label}
            type="button"
            onClick={() => preset(days as number, hour as number)}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-50"
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="datetime-local"
        defaultValue={toLocalInput(value)}
        aria-label="Data do retorno"
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        onBlur={(e) => commit(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-1 text-base md:text-sm"
      />
      <div className="flex justify-between text-xs">
        {value ? (
          <button type="button" className="text-red-700 hover:underline" onClick={() => commit("")}>
            Remover retorno
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="text-zinc-600 hover:underline" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditing(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Opens WhatsApp with a ready-made message and records the contact. */
export function WhatsAppButton({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const { slug, company, templates } = usePanel();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const digits = whatsappDigits(lead.phone);

  const send = (templateName: string, text: string | null) => {
    const url = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
    start(async () => {
      await logContact(slug, lead.id, templateName);
    });
  };

  if (!digits) {
    return (
      <span className={`text-xs text-amber-700 ${compact ? "" : "self-center"}`} title="Preencha o telefone para abrir o WhatsApp">
        Sem telefone
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 rounded-md bg-emerald-600 font-medium text-white hover:bg-emerald-700 ${
          compact ? "px-2 py-1 text-xs" : "min-h-10 px-3 py-2 text-sm"
        }`}
      >
        WhatsApp
      </button>
      {open && (
        <BottomSheet title={`Mensagem para ${lead.name?.split(/\s+/)[0] ?? lead.code}`} onClose={() => setOpen(false)}>
          <ul className="flex flex-col gap-2">
            {templates.map((t) => {
              const text = fillTemplate(t.body, { name: lead.name, company });
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => send(t.name, text)}
                    className="w-full rounded-md border border-zinc-200 p-3 text-left hover:border-emerald-600 hover:bg-emerald-50"
                  >
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="mt-1 line-clamp-3 text-sm text-zinc-600">{text}</div>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => send("Sem mensagem pronta", null)}
                className="w-full rounded-md border border-dashed border-zinc-300 p-3 text-left text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Abrir conversa sem mensagem
              </button>
            </li>
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Ao abrir a conversa, o primeiro contato fica registrado e um lead novo passa para &quot;Em atendimento&quot;.
          </p>
        </BottomSheet>
      )}
    </>
  );
}

const ACTOR: Record<string, string> = { lp: "Landing Page", atendente: "Atendente", admin: "Administrador", sistema: "Sistema" };

function statusText(value: string | null) {
  if (!value) return "—";
  const [status, ...reason] = value.split(" · ");
  const label = STATUSES[status as Status] ?? status;
  return reason.length ? `${label} (${reason.join(" · ")})` : label;
}

export function describeHistory(h: HistoryEntry): string {
  switch (h.type) {
    case "created":
      return h.to ?? "Lead criado";
    case "click":
      return `Clicou de novo no WhatsApp (${h.to} cliques)`;
    case "status":
      return `Status: ${statusText(h.from)} → ${statusText(h.to)}`;
    case "phone":
      return h.to ? `Telefone: ${formatPhone(h.to)}` : "Telefone apagado";
    case "name":
      return h.to ? `Nome: ${h.to}` : "Nome apagado";
    case "note":
      return h.to ? `Observação: ${h.to}` : "Observação apagada";
    case "sale_value":
      return h.to ? `Valor da venda: ${formatMoney(h.to)}` : "Valor da venda apagado";
    case "next_contact":
      return h.to ? `Retorno agendado para ${formatDateTime(h.to)}` : "Retorno removido";
    case "message":
      return `WhatsApp aberto: ${h.to}`;
    case "meta":
      return `Meta: ${h.to}`;
    default:
      return h.type;
  }
}

export function HistoryButton({ lead, className = "" }: { lead: Lead; className?: string }) {
  const { slug } = usePanel();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = () => {
    setOpen(true);
    start(async () => {
      const result = await leadHistory(slug, lead.id);
      setHistory(result.history ?? null);
      setError(result.error ?? null);
    });
  };

  return (
    <>
      <button type="button" onClick={show} className={`text-sm text-zinc-600 hover:underline ${className}`}>
        Histórico
      </button>
      {open && (
        <BottomSheet title={`Histórico · ${lead.code}`} onClose={() => setOpen(false)}>
          {lead.first_contact_at && (
            <p className="mb-3 rounded bg-zinc-50 px-3 py-2 text-sm">
              Primeiro contato em{" "}
              <strong>
                {formatMinutes((new Date(lead.first_contact_at).getTime() - new Date(lead.created_at).getTime()) / 60_000)}
              </strong>{" "}
              depois do clique.
            </p>
          )}
          {pending && !history && <p className="text-sm text-zinc-500">Carregando...</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {history && (
            <ol className="relative flex flex-col gap-3 border-l border-zinc-200 pl-4">
              {[...history].reverse().map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-white bg-zinc-400" />
                  <div className="text-sm">{describeHistory(h)}</div>
                  <div className="text-xs text-zinc-500">
                    {formatDateTime(h.at)} · {ACTOR[h.actor] ?? h.actor}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </BottomSheet>
      )}
    </>
  );
}

/** "esperando há 12 min", colored by how long the lead has waited. */
export function WaitTimer({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, []);
  if (now === null) return null;
  const minutes = Math.max(0, (now - new Date(since).getTime()) / 60_000);
  const tone = minutes < 5 ? "bg-emerald-100 text-emerald-800" : minutes < 30 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      esperando há {formatMinutes(Math.floor(minutes))}
    </span>
  );
}
