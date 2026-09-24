"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { createProject } from "./actions";

export function CreateProjectForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createProject.bind(null, slug), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome do projeto" hint="Profissional, unidade, marca ou serviço.">
        <input name="name" required maxLength={120} placeholder="Dra Letícia" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Criar projeto
      </Button>
    </form>
  );
}
