"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { resetAdminPassword } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAdminPassword.bind(null, token), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Senha nova" hint="Pelo menos 10 caracteres.">
        <input name="new_password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={inputClass} />
      </Field>
      <Field label="Repita a senha nova">
        <input name="confirm_password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar senha"}
      </Button>
    </form>
  );
}
