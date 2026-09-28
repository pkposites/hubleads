"use client";

import { useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button, Field, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { createSheetSource, rotateSheetSourceKey, updateSheetSource } from "../../../actions";

export interface SheetSource {
  id: string;
  name: string;
  key_hint: string;
  enabled: boolean;
  created_at: string;
  last_received_at: string | null;
  leads_received: number;
  last_error: string | null;
}

/** Google Sheets sources: each sheet gets its own key and a ready Apps Script. */
export function SheetSources({ workspaceId, sources }: { workspaceId: string; sources: SheetSource[] }) {
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ script?: string; error?: string }>) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
      if (result.script) setScript(result.script);
    });

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-zinc-600">
        Para leads que já caem numa planilha do Google, como a integração nativa dos formulários da Meta com o Google Sheets. Um
        script na planilha manda cada linha nova para o Lead Hub a cada minuto. Linhas com o ID do lead da Meta viram
        &quot;Formulário Meta&quot; e voltam para a Meta como eventos de CRM (Agendado e Venda). As demais viram &quot;Planilha&quot;.
      </p>

      {sources.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
              <div>
                <div className="font-medium">
                  {s.name} <span className={`text-xs ${s.enabled ? "text-emerald-700" : "text-zinc-500"}`}>{s.enabled ? "ativa" : "pausada"}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  Chave ••••{s.key_hint} · {s.leads_received} {s.leads_received === 1 ? "lead recebido" : "leads recebidos"} ·{" "}
                  {s.last_received_at ? `último envio ${formatDateTime(s.last_received_at)}` : "ainda não enviou nada"}
                </div>
                {s.last_error && <div className="text-xs text-red-700">{s.last_error}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" disabled={busy} onClick={() => run(async () => updateSheetSource(workspaceId, s.id, { enabled: !s.enabled }))}>
                  {s.enabled ? "Pausar" : "Retomar"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Gerar uma chave nova? O script atual para de funcionar até você colar o novo na planilha.")) {
                      run(() => rotateSheetSourceKey(workspaceId, s.id));
                    }
                  }}
                >
                  Nova chave
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remover "${s.name}"? Os leads que já chegaram continuam na planilha do Lead Hub.`)) {
                      run(async () => updateSheetSource(workspaceId, s.id, { remove: true }));
                    }
                  }}
                >
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {script ? (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium text-emerald-900">Copie o script agora: a chave dentro dele não aparece de novo.</p>
          <ol className="list-decimal space-y-1 pl-5 text-emerald-900">
            <li>Abra a planilha que recebe os leads → menu <strong>Extensões → Apps Script</strong>.</li>
            <li>Apague o que estiver no editor, cole o script e clique em <strong>Salvar</strong> (ícone de disquete).</li>
            <li>
              No seletor de função, no topo, escolha <strong>instalar</strong> e clique em <strong>Executar</strong>. Autorize com a
              sua conta Google. Se aparecer &quot;app não verificado&quot;, use <em>Avançado → Acessar</em>.
            </li>
            <li>
              Para mandar também os leads que já estão na planilha, escolha <strong>importarTudo</strong> e clique em Executar.
              Repetidos não entram duas vezes.
            </li>
          </ol>
          <div className="flex justify-end">
            <CopyButton text={script} label="Copiar script" />
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-white p-2 text-xs">{script}</pre>
          <Button variant="secondary" className="self-start" onClick={() => setScript(null)}>
            Já colei na planilha
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createSheetSource(workspaceId, name));
          }}
        >
          <Field label="Nova conexão com planilha">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Formulário Kaslic Ibirapuera" className={`${inputClass} w-72`} />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Gerando..." : "Gerar script"}
          </Button>
        </form>
      )}

      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
