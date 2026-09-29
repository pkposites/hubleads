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
    <div className="flex flex-col gap-1 text-zinc-700">
      <p>
        <strong>Para que serve:</strong> quando alguém que clicou num anúncio do Google vira lead, agenda ou compra, o Lead Hub conta isso para o
        Google Ads. Assim o Google aprende quem vira cliente e passa a mostrar o anúncio para pessoas parecidas.
      </p>
      <p className="text-zinc-600">
        Você configura uma vez só, no Google Ads do cliente (uns 10 minutos, mais uma espera de 6 horas que o Google exige). Depois disso o
        Google busca as novidades aqui sozinho, todo dia.
      </p>
    </div>
  );

  if (!data) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        {intro}
        {error && <p className="text-red-700">{error}</p>}
        <Button className="self-start" disabled={busy} onClick={generate}>
          {busy ? "Gerando..." : "Ativar retorno para o Google Ads"}
        </Button>
        {access && (
          <>
            <AccessBox access={access} />
            <Guide names={names} open />
          </>
        )}
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
            ["lead_name", "send_lead", "Lead (chegou um contato)"],
            ["schedule_name", "send_schedule", "Agendamento"],
            ["purchase_name", "send_purchase", "Venda (vai com o valor)"],
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
        O nome de cada conversão aqui tem que ser <strong>igual</strong> ao que você criar no Google Ads (mesmas letras, espaços e traços).
        Desmarque o que não quiser mandar.
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
        <AccessBox access={access} />
      ) : (
        <div className="flex flex-col gap-1 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
          <span className="font-medium text-zinc-800">Dados para colar no Google Ads</span>
          <span>
            Endereço: <code className="break-all font-mono">{`${origin}/api/google-ads/${data.feed_id}`}</code>
          </span>
          <span>
            Usuário: <code className="font-mono">{data.username}</code>
          </span>
          <span>
            Senha: por segurança, só aparece na hora em que é criada. Se perdeu, clique em &quot;Nova senha&quot; (a antiga para de funcionar e
            você atualiza no Google Ads).
          </span>
        </div>
      )}
      <Guide names={names} open={Boolean(access) || !data.last_fetch_at} />
    </div>
  );
}

function AccessBox({ access }: { access: Access }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
      <p className="font-medium">Guarde estes dados agora: a senha não aparece de novo. Você vai colar os três no Google Ads (Parte 2 abaixo).</p>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
        {(
          [
            ["Endereço", access.url],
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
    </div>
  );
}

/** The step-by-step in Google Ads, in plain words. */
function Guide({ names, open }: { names: { lead_name: string; schedule_name: string; purchase_name: string }; open: boolean }) {
  const name = (text: string) => <code className="rounded bg-white px-1 py-0.5 font-mono text-[13px] text-zinc-900 ring-1 ring-zinc-200">{text}</code>;
  return (
    <details open={open} className="rounded-md border border-zinc-200 p-3">
      <summary className="cursor-pointer font-medium">Como configurar no Google Ads (passo a passo)</summary>
      <div className="mt-3 flex flex-col gap-4 text-zinc-700">
        <section>
          <h4 className="font-semibold text-zinc-900">Parte 1: criar as 3 conversões (uma vez só)</h4>
          <ol className="mt-1 list-decimal space-y-1.5 pl-5">
            <li>
              Entre no Google Ads do cliente. No menu da esquerda, clique em <strong>Metas</strong> e depois em <strong>Conversões</strong>.
            </li>
            <li>
              Clique no botão azul <strong>+ Criar ação de conversão</strong>.
            </li>
            <li>
              Escolha <strong>Importar</strong>, depois <strong>Outras fontes de dados ou CRMs</strong> e depois <strong>Rastrear conversões de
              cliques</strong>. Clique em Continuar.
            </li>
            <li>
              No nome, escreva exatamente {name(names.lead_name)} e salve. Faça de novo para {name(names.schedule_name)} e para{" "}
              {name(names.purchase_name)}. Na Venda, em &quot;Valor&quot;, escolha <strong>Usar valores diferentes para cada conversão</strong>.
            </li>
            <li>
              Deixe como <strong>meta principal</strong> só a conversão que você quer que o Google busque mais (em geral Agendamento ou Venda). As
              outras ficam como <strong>secundárias</strong>, só para você acompanhar. Assim o mesmo cliente não é contado duas vezes.
            </li>
          </ol>
        </section>
        <section>
          <h4 className="font-semibold text-zinc-900">Parte 2: ligar o envio automático (6 horas depois da Parte 1)</h4>
          <p className="text-xs text-zinc-500">O Google só aceita receber dados 6 horas depois que as conversões são criadas.</p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-5">
            <li>
              Em <strong>Metas → Conversões</strong>, clique em <strong>Uploads</strong>.
            </li>
            <li>
              Clique em <strong>Programações</strong> e depois no botão <strong>+</strong>.
            </li>
            <li>
              Em &quot;Fonte&quot;, escolha <strong>HTTPS</strong>.
            </li>
            <li>
              Cole o <strong>endereço</strong>, o <strong>usuário</strong> e a <strong>senha</strong> do Lead Hub (mostrados acima).
            </li>
            <li>
              Em &quot;Frequência&quot;, escolha <strong>Todos os dias</strong> e salve.
            </li>
          </ol>
        </section>
        <section className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600">
          <p>
            <strong>Pronto.</strong> Para conferir se está funcionando: aqui no Lead Hub aparece &quot;Última busca do Google&quot;, e no Google Ads,
            em Uploads, fica o histórico de cada busca.
          </p>
          <p className="mt-1">
            <strong>Só entram leads que clicaram num anúncio do Google.</strong> Para isso, a LP precisa ter o código do Lead Hub instalado e a
            opção <strong>codificação automática</strong> precisa estar ligada no Google Ads (em Configurações da conta; já vem ligada).
          </p>
          <p className="mt-1">
            Uma venda que pulou o &quot;Agendado&quot; também conta como Agendamento, para o Google não perder esse cliente.
          </p>
        </section>
      </div>
    </details>
  );
}
