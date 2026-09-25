"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { saveMetaSettings, sendMetaTest } from "../../../actions";

export interface MetaSettingsData {
  configured: boolean;
  pixel_id: string | null;
  token_hint: string | null;
  test_event_code: string | null;
  enabled: boolean;
  send_schedule: boolean;
  send_purchase: boolean;
  recent: { event: string; ok: boolean; test: boolean; at: string; response: string | null }[];
  failures_24h: number;
  last_error: string | null;
  last_ok_at: string | null;
  /** Schedule/Purchase the landing page also fires through the pixel or GTM. */
  lp_conflicts: string[];
}

export function MetaSettings({
  workspaceId,
  data,
  pixels,
  serverReady,
}: {
  workspaceId: string;
  data: MetaSettingsData;
  /** Pixel ids the client's landing pages used in the last 30 days. */
  pixels: string[];
  serverReady: { secret: boolean; key: boolean };
}) {
  const [state, action, pending] = useActionState(saveMetaSettings.bind(null, workspaceId), undefined);
  const [testing, startTest] = useTransition();
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  // Typed but not saved yet: the automatic sending uses only what is saved.
  const [dirty, setDirty] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Quando o atendente marca um lead como <strong>Agendado</strong>, o Lead Hub envia o evento <code>Schedule</code>; quando marca{" "}
        <strong>Venda</strong> com valor, envia <code>Purchase</code> com o valor. Cada evento vai uma vez por lead, com telefone e nome
        criptografados (SHA-256), fbc, fbp, IP e navegador do clique, para a Meta atribuir ao anúncio.
      </p>
      {(!serverReady.secret || !serverReady.key) && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          O servidor ainda não tem {[!serverReady.secret && "LH_SERVER_SECRET", !serverReady.key && "LH_ENCRYPTION_KEY"].filter(Boolean).join(" e ")}:
          o token não pode ser salvo e os eventos não serão enviados até isso ser configurado.
        </p>
      )}
      {data.enabled && data.failures_24h > 0 && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          <p className="font-medium">
            {data.failures_24h} {data.failures_24h === 1 ? "envio falhou" : "envios falharam"} nas últimas 24 horas.
          </p>
          <p className="mt-1">
            O Lead Hub tenta de novo sozinho a cada hora (até 6 vezes por evento, por até 7 dias). Se o erro falar em token (&quot;OAuth&quot;,
            &quot;access token&quot;), gere um token novo no Gerenciador de Eventos e salve aqui.
            {data.last_ok_at ? ` Último envio aceito: ${formatDateTime(data.last_ok_at)}.` : ""}
          </p>
          {data.last_error && <p className="mt-1 break-all text-xs text-red-700">Último erro: {data.last_error.slice(0, 300)}</p>}
        </div>
      )}
      {data.enabled && data.lp_conflicts.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          <p className="font-medium">A landing page também envia {data.lp_conflicts.join(" e ")} pelo pixel ou pelo GTM.</p>
          <p className="mt-1">
            A Meta contaria o mesmo resultado duas vezes. Mude o nome desse evento na LP (por exemplo, &quot;CliqueAgendar&quot;) ou desligue a
            opção correspondente abaixo. O evento do Lead Hub é o confiável: só vai quando o atendente confirma.
          </p>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        O token é criptografado (AES-256) antes de ir para o banco e nunca volta para a tela: aparecem só os 4 últimos caracteres.
      </p>
      {pixels.length > 0 && data.pixel_id && !pixels.includes(data.pixel_id) && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          Atenção: a LP usa o pixel {pixels.join(", ")}, diferente do salvo aqui ({data.pixel_id}). As conversões iriam para outro
          conjunto de dados e não se juntariam aos cliques do anúncio.
        </p>
      )}
      <form action={action} onChange={() => setDirty(true)} onSubmit={() => setDirty(false)} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="ID do pixel (conjunto de dados)"
            hint={pixels.length ? `Encontrado na LP: ${pixels.join(", ")}` : "Aparece aqui sozinho quando a LP disparar um evento do pixel."}
          >
            <input
              name="pixel_id"
              inputMode="numeric"
              required
              defaultValue={data.pixel_id ?? pixels[0] ?? ""}
              placeholder="123456789012345"
              className={inputClass}
            />
          </Field>
          <Field
            label="Token de acesso da API de Conversões"
            hint={data.token_hint ? `Salvo: ${data.token_hint}. Deixe em branco para manter.` : "Gerenciador de Eventos → Configurações → Gerar token."}
          >
            <input name="access_token" type="password" autoComplete="off" placeholder={data.token_hint ?? "EAA..."} className={inputClass} />
          </Field>
          <Field label="Código de teste (opcional)" hint="Com o código, os eventos aparecem só em Testar eventos. Apague para valer de verdade.">
            <input name="test_event_code" defaultValue={data.test_event_code ?? ""} placeholder="TEST12345" className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="enabled" defaultChecked={data.enabled} /> Enviar conversões para a Meta
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_schedule" defaultChecked={data.send_schedule} /> Agendado → Schedule
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_purchase" defaultChecked={data.send_purchase} /> Venda com valor → Purchase
          </label>
        </div>
        {dirty && !pending ? (
          <p className="text-sm font-medium text-amber-700">Alterações não salvas: clique em Salvar para valerem.</p>
        ) : (
          <FormMessage state={state} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
          </Button>
          {data.configured && (
            <Button
              type="button"
              variant="secondary"
              disabled={testing}
              onClick={(e) => {
                const input = e.currentTarget.form?.elements.namedItem("test_event_code") as HTMLInputElement | null;
                const code = input?.value ?? "";
                startTest(async () => setTest(await sendMetaTest(workspaceId, code)));
              }}
            >
              {testing ? "Enviando..." : "Enviar evento de teste"}
            </Button>
          )}
        </div>
        {test && <p className={`text-sm ${test.ok ? "text-emerald-700" : "text-red-700"}`}>{test.message}</p>}
      </form>
      {data.recent.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Últimos envios</h3>
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.recent.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-xs text-zinc-500">{formatDateTime(e.at)}</span>
                <span className="font-medium">{e.event}</span>
                <span className={e.ok ? "text-emerald-700" : "text-red-700"}>{e.ok ? "aceito" : "falhou"}</span>
                {e.test && <span className="text-xs text-zinc-500">teste</span>}
                {!e.ok && e.response && <span className="w-full break-all text-xs text-zinc-500">{e.response.slice(0, 300)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
