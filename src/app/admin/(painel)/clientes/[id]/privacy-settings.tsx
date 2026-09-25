"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { describeAudit, type PrivacySettings as Settings } from "@/lib/privacy";
import { savePrivacySettings } from "../../../actions";

export function PrivacySettings({ workspaceId, data, policyUrl }: { workspaceId: string; data: Settings; policyUrl: string }) {
  const [state, action, pending] = useActionState(savePrivacySettings.bind(null, workspaceId), undefined);
  return (
    <div className="flex flex-col gap-4">
      {!data.email && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta o e-mail de privacidade: a LGPD exige um canal para os titulares pedirem acesso, correção ou exclusão dos dados.
        </p>
      )}
      <p className="text-sm text-zinc-600">
        Estes dados aparecem na política de privacidade pública do cliente, usada no banner de consentimento das LPs:{" "}
        <a href={policyUrl} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-zinc-900 underline">
          {policyUrl}
        </a>
        . O texto é um modelo: peça ao jurídico do cliente para revisar.
      </p>
      <form action={action} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Controlador (razão social ou nome)">
            <input name="controller" maxLength={200} defaultValue={data.controller ?? ""} placeholder="Clínica Exemplo Ltda" className={inputClass} />
          </Field>
          <Field label="CNPJ ou CPF (opcional)">
            <input name="document" maxLength={40} defaultValue={data.document ?? ""} placeholder="00.000.000/0001-00" className={inputClass} />
          </Field>
          <Field label="E-mail para assuntos de privacidade">
            <input name="email" type="email" maxLength={200} defaultValue={data.email ?? ""} placeholder="privacidade@clinica.com.br" className={inputClass} />
          </Field>
          <Field label="Prazo de guarda dos leads (meses)" hint="Depois disso, leads sem atividade são apagados automaticamente.">
            <input name="retention_months" type="number" min={1} max={120} defaultValue={data.retention_months} className={inputClass} />
          </Field>
        </div>
        <FormMessage state={state} />
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Registro de exportações e exclusões</h3>
        {data.audit.length === 0 ? (
          <p className="text-sm text-zinc-500">Nada registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.audit.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>{describeAudit(a)}</span>
                <span className="text-xs text-zinc-500">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
