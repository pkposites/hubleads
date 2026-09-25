"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { changeAdminPassword } from "../../actions";

export function PasswordForm({ login }: { login: string }) {
  const [state, action, pending] = useActionState(changeAdminPassword, undefined);
  return (
    // The key clears the fields after a successful change.
    <form key={state?.ok ? "done" : "form"} action={action} className="flex flex-col gap-3">
      {/* Lets the browser's password manager save the new password for this login. */}
      <input type="hidden" name="username" autoComplete="username" value={login} readOnly />
      <Field label="Senha atual">
        <input name="current_password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Field label="Senha nova" hint="Pelo menos 10 caracteres.">
        <input name="new_password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={inputClass} />
      </Field>
      <Field label="Repita a senha nova">
        <input name="confirm_password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando..." : "Trocar senha"}
      </Button>
    </form>
  );
}
