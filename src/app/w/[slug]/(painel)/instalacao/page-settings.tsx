"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import type { Page } from "@/lib/leads";
import { updatePage } from "../../actions";

export function PageSettings({ slug, page }: { slug: string; page: Page }) {
  const [state, action, pending] = useActionState(updatePage.bind(null, slug, page.id), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da Landing Page">
        <input name="name" defaultValue={page.name} className={inputClass} />
      </Field>
      <Field
        label="Domínios autorizados"
        hint="Separados por vírgula. Vazio aceita qualquer domínio (bom para testar). Depois de instalar, informe o domínio da LP."
      >
        <input name="domains" defaultValue={page.domains.join(", ")} placeholder="draleticia.com.br, www.draleticia.com.br" className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="whatsapp_code" defaultChecked={page.whatsapp_code} />
        Incluir o código na mensagem do WhatsApp, por exemplo &quot;(cód. 7F3K)&quot;
      </label>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Salvar
      </Button>
    </form>
  );
}
