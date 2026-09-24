"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClass, Field, FormMessage, inputClass } from "@/components/ui";
import { createClient } from "../../actions";
import { AccessCard } from "../access-card";

export function CreateClientForm({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState(createClient, undefined);

  if (state?.created) {
    const c = state.created;
    return (
      <div className="flex flex-col gap-4">
        <AccessCard origin={origin} name={c.name} slug={c.slug} password={c.password} />
        <div className="flex gap-2">
          <Link href={`/admin/clientes/${c.id}`} className={buttonClass()}>
            Ver código da LP e prompt de instalação →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex max-w-lg flex-col gap-3">
      <Field label="Nome do cliente">
        <input name="name" required maxLength={120} placeholder="Dra Letícia" className={inputClass} />
      </Field>
      <Field label="Endereço de acesso (opcional)" hint="Vira /w/<endereço>. Gerado a partir do nome se vazio.">
        <input name="slug" maxLength={64} placeholder="dra-leticia" className={inputClass} />
      </Field>
      <Field label="Nome da Landing Page">
        <input name="page_name" maxLength={120} placeholder="LP Transplante capilar" className={inputClass} />
      </Field>
      <Field label="Domínio da LP (opcional)" hint="Ex.: draleticia.com.br. Vazio aceita qualquer domínio; preencha depois de testar.">
        <input name="domains" placeholder="draleticia.com.br, www.draleticia.com.br" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Criar cliente e gerar senha
      </Button>
    </form>
  );
}
