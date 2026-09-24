"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import type { Page } from "@/lib/leads";
import { addPage, resetPassword, updatePageSettings } from "../../../actions";
import { AccessCard } from "../../access-card";

export function ResetPassword({ origin, id, name, slug }: { origin: string; id: string; name: string; slug: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ password?: string; error?: string } | null>(null);
  if (result?.password) return <AccessCard origin={origin} name={name} slug={slug} password={result.password} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Gerar uma nova senha? Quem estiver usando a senha atual precisará entrar de novo.")) {
            start(async () => setResult(await resetPassword(id)));
          }
        }}
      >
        Gerar nova senha do atendente
      </Button>
      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
    </div>
  );
}

export function PageSettings({ workspaceId, page }: { workspaceId: string; page: Page }) {
  const [state, action, pending] = useActionState(updatePageSettings.bind(null, workspaceId, page.id), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da Landing Page">
        <input name="name" defaultValue={page.name} className={inputClass} />
      </Field>
      <Field label="Domínios autorizados" hint="Separados por vírgula. Vazio aceita qualquer domínio (bom para testar).">
        <input name="domains" defaultValue={page.domains.join(", ")} placeholder="draleticia.com.br" className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="whatsapp_code" defaultChecked={page.whatsapp_code} />
        Incluir o código na mensagem do WhatsApp, por exemplo &quot;(cód. 7F3K)&quot;
      </label>
      <FormMessage state={state} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Salvar
      </Button>
    </form>
  );
}

export function AddPageForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(addPage.bind(null, workspaceId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Nova Landing Page">
        <input name="name" required placeholder="LP Black Friday" className={`${inputClass} w-56`} />
      </Field>
      <Field label="Domínio (opcional)">
        <input name="domains" placeholder="lp.cliente.com.br" className={`${inputClass} w-56`} />
      </Field>
      <Button type="submit" disabled={pending}>
        Adicionar
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
