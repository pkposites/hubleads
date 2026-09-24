"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { createWorkspace } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da empresa ou cliente">
        <input name="name" required maxLength={120} placeholder="Clínica Exen" className={inputClass} />
      </Field>
      <Field label="Endereço (opcional)" hint="Letras minúsculas, números e hífen. Gerado a partir do nome se vazio.">
        <input name="slug" maxLength={64} placeholder="clinica-exen" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        Criar workspace
      </Button>
    </form>
  );
}
