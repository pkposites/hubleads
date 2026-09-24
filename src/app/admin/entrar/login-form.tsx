"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { adminLogin } from "../actions";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLogin, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="E-mail">
        <input name="login" type="email" required autoComplete="username" defaultValue={state?.login} className={inputClass} />
      </Field>
      <Field label="Senha">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        Entrar
      </Button>
    </form>
  );
}
