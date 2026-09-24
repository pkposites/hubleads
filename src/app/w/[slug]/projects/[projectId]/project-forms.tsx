"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { createApiKey, createForm, createLandingPage, sendTestLead } from "../actions";

interface Props {
  slug: string;
  projectId: string;
}

export function LandingPageForm({ slug, projectId }: Props) {
  const [state, action, pending] = useActionState(createLandingPage.bind(null, slug, projectId), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome">
        <input name="name" required maxLength={120} placeholder="LP transplante" className={inputClass} />
      </Field>
      <Field
        label="Domínios autorizados"
        hint="Separados por vírgula. Inclua www e o domínio de staging se forem usados. *.dominio.com.br cobre subdomínios."
      >
        <input name="domains" required placeholder="cliente.com.br, www.cliente.com.br" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Adicionar Landing Page
      </Button>
    </form>
  );
}

export function FormForm({ slug, projectId }: Props) {
  const [state, action, pending] = useActionState(createForm.bind(null, slug, projectId), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome">
        <input name="name" required maxLength={120} placeholder="Avaliação de transplante capilar" className={inputClass} />
      </Field>
      <Field label="Identificador (opcional)" hint="Vira frm_<identificador>. Gerado a partir do nome se vazio.">
        <input name="key" maxLength={60} placeholder="transplante" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Criar formulário
      </Button>
    </form>
  );
}

export function ApiKeyForm({ slug, projectId }: Props) {
  const [state, action, pending] = useActionState(createApiKey.bind(null, slug, projectId), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da chave">
        <input name="name" maxLength={120} placeholder="Backend do cliente" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      {state?.secret && (
        <code className="block break-all rounded bg-zinc-900 px-3 py-2 font-mono text-xs text-white">{state.secret}</code>
      )}
      <Button type="submit" disabled={pending} variant="secondary" className="self-start">
        Gerar chave secreta
      </Button>
    </form>
  );
}

export function TestLeadButton({ slug, projectId }: Props) {
  const [state, action, pending] = useActionState(() => sendTestLead(slug, projectId), undefined);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending} variant="secondary">
        Enviar lead de teste
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
