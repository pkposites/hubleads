"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { login } from "./w/[slug]/actions";

export function LoginForm({ slug }: { slug?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      {slug ? (
        <input type="hidden" name="slug" value={slug} />
      ) : (
        <Field label="Empresa" hint="O endereço que você recebeu, por exemplo dra-leticia.">
          <input name="slug" required autoCapitalize="none" defaultValue={state?.slug} className={inputClass} />
        </Field>
      )}
      <Field label="Senha">
        <input name="password" type="password" required autoFocus={Boolean(slug)} className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        Entrar
      </Button>
    </form>
  );
}
