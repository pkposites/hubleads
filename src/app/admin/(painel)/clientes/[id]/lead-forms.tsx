"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass, controlClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import {
  connectLeadForm,
  loadLeadForms,
  removeLeadToken,
  saveLeadToken,
  setLeadFormEnabled,
  type MetaPageForms,
} from "../../../actions";

export interface LeadFormsData {
  has_token: boolean;
  token_hint: string | null;
  forms: {
    id: string;
    page_id: string;
    page_name: string | null;
    form_id: string;
    form_name: string | null;
    enabled: boolean;
    last_sync_at: string | null;
    last_error: string | null;
    leads_imported: number;
    since: string;
  }[];
}

const IMPORT_OPTIONS: [number, string][] = [
  [0, "Só os leads novos, a partir de agora"],
  [1, "Trazer também as últimas 24 horas"],
  [7, "Trazer também os últimos 7 dias"],
  [30, "Trazer também os últimos 30 dias"],
  [90, "Trazer também os últimos 90 dias"],
];

/** Meta native forms (Lead Ads): token, connected forms and adding a form. */
export function LeadForms({ workspaceId, data, serverReady }: { workspaceId: string; data: LeadFormsData; serverReady: boolean }) {
  const [changing, setChanging] = useState(!data.has_token);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveLeadToken>>, formData: FormData) => {
    const result = await saveLeadToken(workspaceId, prev, formData);
    // A saved token closes the token form and shows the forms part.
    if (result?.ok) setChanging(false);
    return result;
  }, undefined);
  const [busy, start] = useTransition();
  const [pages, setPages] = useState<MetaPageForms[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDays, setImportDays] = useState(0);
  const connected = new Set(data.forms.map((f) => f.form_id));


  const run = (fn: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result && "error" in result && result.error) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-zinc-600">
        Os leads dos formulários nativos (Facebook e Instagram) caem direto na planilha e na fila Atender, em até 1 minuto, com
        campanha, conjunto, anúncio e as respostas. Quando o atendente marca <strong>Agendado</strong> ou <strong>Venda</strong>, o
        Lead Hub avisa a Meta como evento de CRM (com o ID do lead), usando o conjunto de dados do cartão abaixo.
      </p>
      {!serverReady && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">Falta configurar LH_SERVER_SECRET e LH_ENCRYPTION_KEY no servidor.</p>}

      {changing ? (
        <form action={action} className="flex flex-col gap-2">
          <Field
            label="Token do usuário do sistema (Meta)"
            hint="Gerenciador de Negócios → Usuários do sistema → Gerar token, com leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads e ads_management. Fica criptografado; só os 4 últimos caracteres aparecem depois."
          >
            <input name="lead_token" type="password" autoComplete="off" placeholder="EAA..." className={inputClass} />
          </Field>
          <FormMessage state={state} />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Verificando com a Meta..." : "Salvar token"}
            </Button>
            {data.has_token && (
              <Button type="button" variant="secondary" onClick={() => setChanging(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Token salvo: <span className="font-mono">••••{data.token_hint}</span>
          </span>
          <Button variant="secondary" onClick={() => setChanging(true)}>
            Trocar token
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Remover o token? Todos os formulários deste cliente param de trazer leads.")) run(() => removeLeadToken(workspaceId));
            }}
          >
            Remover
          </Button>
        </div>
      )}

      {state?.ok && <FormMessage state={state} />}

      {data.forms.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                {["Formulário", "Página", "Leads trazidos", "Última checagem", ""].map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.forms.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{f.form_name ?? f.form_id}</div>
                    <div className={`text-xs ${f.enabled ? "text-emerald-700" : "text-zinc-500"}`}>{f.enabled ? "Ativo" : "Pausado"}</div>
                    {f.last_error && <div className="mt-1 text-xs text-red-700">{f.last_error}</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{f.page_name ?? f.page_id}</td>
                  <td className="py-2 pr-3 tabular-nums">{f.leads_imported}</td>
                  <td className="py-2 pr-3 text-xs">{f.last_sync_at ? formatDateTime(f.last_sync_at) : "Aguardando"}</td>
                  <td className="py-2">
                    <Button variant="secondary" disabled={busy} onClick={() => run(() => setLeadFormEnabled(workspaceId, f, !f.enabled))}>
                      {f.enabled ? "Pausar" : "Retomar"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.has_token && !changing && (
        <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await loadLeadForms(workspaceId);
                  if (result.pages) setPages(result.pages);
                  return result;
                })
              }
            >
              {busy && !pages ? "Buscando na Meta..." : "Adicionar formulário"}
            </Button>
            {pages && (
              <select value={importDays} onChange={(e) => setImportDays(Number(e.target.value))} className={controlClass} aria-label="Importar">
                {IMPORT_OPTIONS.map(([days, label]) => (
                  <option key={days} value={days}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {pages?.length === 0 && <p className="text-zinc-600">O token não enxerga nenhuma Página. Atribua a Página ao usuário do sistema.</p>}
          {pages?.map((page) => (
            <div key={page.id}>
              <div className="font-medium">{page.name}</div>
              {page.error && <p className="text-xs text-red-700">{page.error}</p>}
              {!page.error && page.forms.length === 0 && <p className="text-xs text-zinc-500">Nenhum formulário nesta Página.</p>}
              <ul className="mt-1 flex flex-col gap-1">
                {page.forms.map((form) => (
                  <li key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-zinc-50 px-2 py-1.5">
                    <span>
                      {form.name}
                      <span className="ml-1 text-xs text-zinc-500">
                        {form.status === "ACTIVE" ? "ativo" : form.status.toLowerCase()}
                        {form.leads !== null && ` · ${form.leads} leads`}
                      </span>
                    </span>
                    {connected.has(form.id) ? (
                      <span className="text-xs text-emerald-700">Conectado</span>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            connectLeadForm(workspaceId, { page_id: page.id, page_name: page.name, form_id: form.id, form_name: form.name }, importDays),
                          )
                        }
                      >
                        Conectar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
