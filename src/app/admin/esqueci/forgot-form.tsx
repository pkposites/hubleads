"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { requestAdminReset } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestAdminReset, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="E-mail">
        <input name="login" type="email" required autoComplete="username" defaultValue={state?.login} className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
