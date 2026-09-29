"use client";

import { useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button, Field, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { GoogleAdsSettings } from "@/lib/google-ads";
import { googleAdsCredentials, updateGoogleAds } from "../../../actions";

type Access = { url: string; username: string; password: string };

/** Conversions back to Google Ads: a file Google Ads fetches every day. */
export function GoogleAds({ workspaceId, data, origin }: { workspaceId: string; data: GoogleAdsSettings | null; origin: string }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [names, setNames] = useState({
    lead_name: data?.lead_name ?? "Lead Hub - Lead",
    schedule_name: data?.schedule_name ?? "Lead Hub - Agendamento",
    purchase_name: data?.purchase_name ?? "Lead Hub - Venda",
  });

  const generate = () =>
    start(async () => {
      setError(null);
      const result = await googleAdsCredentials(workspaceId);
      if (result.error || !result.settings?.password || !result.url) return setError(result.error ?? "Não foi possível gerar o acesso.");
      setAccess({ url: result.url, username: result.settings.username, password: result.settings.password });
    });
  const save = (change: Parameters<typeof updateGoogleAds>[1]) =>
    start(async () => {
      setError(null);
      setSaved(false);
      const result = await updateGoogleAds(workspaceId, change);
      if (result.error) setError(result.error);
      else setSaved(true);
    });

  const intro = (
    <p className="text-zinc-600">
      Leva para o Google Ads os leads que vieram de um anúncio do Google (com o código de clique <em>gclid</em>): <strong>Lead</strong> quando o
      lead chega, <strong>Agendamento</strong> e <strong>Venda</strong> com o valor. Assim o Google aprende quais cliques viram cliente. Funciona
      por um arquivo que o próprio Google Ads busca todo dia, protegido por usuário e senha; não precisa de acesso à API do Google.
    </p>
  );

  if (!data) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        {intro}
        {error && <p className="text-red-700">{error}</p>}
        <Button className="self-start" disabled={busy} onClick={generate}>
          {busy ? "Gerando..." : "Ativar retorno para o Google Ads"}
        </Button>
        {access && <AccessBox access={access} names={names} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {intro}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
        <span className={data.enabled ? "font-medium text-emerald-700" : "font-medium text-zinc-500"}>{data.enabled ? "Ativo" : "Pausado"}</span>
        <span>
          {data.last_fetch_at
            ? `Última busca do Google: ${formatDateTime(data.last_fetch_at)} (${data.last_rows ?? 0} ${data.last_rows === 1 ? "conversão" : "conversões"})`
            : "O Google Ads ainda não buscou o arquivo."}
        </span>
        <span>
          {data.with_gclid_90d} {data.with_gclid_90d === 1 ? "lead" : "leads"} com clique do Google nos últimos 90 dias
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["lead_name", "send_lead", "Lead (chegou)"],
            ["schedule_name", "send_schedule", "Agendamento"],
            ["purchase_name", "send_purchase", "Venda (com valor)"],
          ] as const
        ).map(([nameKey, sendKey, label]) => (
          <div key={nameKey} className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" defaultChecked={data[sendKey]} disabled={busy} onChange={(e) => save({ [sendKey]: e.target.checked })} />
              {label}
            </label>
            <Field label="Nome da conversão no Google Ads">
              <input
                className={inputClass}
                value={names[nameKey]}
                maxLength={100}
                onChange={(e) => setNames((n) => ({ ...n, [nameKey]: e.target.value }))}
              />
            </Field>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500">
        Os nomes precisam ser idênticos aos das conversões criadas no Google Ads (maiúsculas, espaços e traços). Uma venda que não passou por
        Agendado também conta como Agendamento, para a campanha não perder esse sinal. Entram as conversões dos últimos 30 dias de leads com
        clique do Google dos últimos 90 dias; o Google ignora as que já recebeu.
      </p>

      {error && <p className="text-red-700">{error}</p>}
      {saved && !error && <p className="text-emerald-700">Salvo.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => save(names)}>
          Salvar nomes
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => save({ enabled: !data.enabled })}>
          {data.enabled ? "Pausar" : "Retomar"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={generate}>
          Nova senha
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Desligar o retorno para o Google Ads? O endereço e a senha deixam de funcionar.")) save({ remove: true });
          }}
        >
          Desligar
        </Button>
      </div>

      {access ? (
        <AccessBox access={access} names={names} />
      ) : (
        <p className="text-xs text-zinc-500">
          Endereço do arquivo: <code className="font-mono">{`${origin}/api/google-ads/${data.feed_id}`}</code> · usuário{" "}
          <code className="font-mono">{data.username}</code> · a senha só aparece quando é gerada (use &quot;Nova senha&quot; se perdeu; a antiga
          para de funcionar).
        </p>
      )}
    </div>
  );
}

function AccessBox({ access, names }: { access: Access; names: { lead_name: string; schedule_name: string; purchase_name: string } }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
      <p className="font-medium">Anote agora: a senha não aparece de novo.</p>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
        {(
          [
            ["Endereço (URL)", access.url],
            ["Usuário", access.username],
            ["Senha", access.password],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs">{label}</dt>
            <dd className="break-all font-mono text-xs">{value}</dd>
            <CopyButton text={value} />
          </div>
        ))}
      </dl>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>
          No Google Ads do cliente: <strong>Metas → Conversões → Resumo → + Nova ação de conversão → Importar →</strong> &quot;Outras fontes de dados
          ou CRMs&quot; → <strong>Rastrear conversões de cliques</strong>.
        </li>
        <li>
          Crie uma conversão para cada nome, exatamente assim: <strong>{names.lead_name}</strong>, <strong>{names.schedule_name}</strong> e{" "}
          <strong>{names.purchase_name}</strong>. Na venda, escolha &quot;Usar valores diferentes para cada conversão&quot;. Deixe como meta principal
          só a que a campanha deve otimizar (em geral Agendamento ou Venda).
        </li>
        <li>
          Espere cerca de 6 horas (o Google exige esse tempo depois de criar as conversões) e vá em{" "}
          <strong>Metas → Conversões → Uploads → Programações → + (nova programação)</strong>.
        </li>
        <li>
          Fonte: <strong>HTTPS</strong>. Cole o endereço, o usuário e a senha acima. Frequência: <strong>todos os dias</strong>. Salve.
        </li>
        <li>No mesmo lugar, &quot;Visualizar uploads&quot; mostra o resultado de cada busca. Aqui no Lead Hub aparece a data da última busca.</li>
      </ol>
      <p className="text-xs">
        Para ter o clique do Google nos leads, o anúncio precisa da <strong>codificação automática (gclid)</strong> ligada na conta do Google Ads
        (vem ligada por padrão) e a LP precisa do código do Lead Hub instalado.
      </p>
    </div>
  );
}
