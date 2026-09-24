"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { signIn, signUp } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction, signingIn] = useActionState(signIn, undefined);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, undefined);
  const isSignIn = mode === "signin";

  return (
    <div className="flex flex-col gap-4">
      <form action={isSignIn ? signInAction : signUpAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        {!isSignIn && (
          <Field label="Nome">
            <input name="full_name" className={inputClass} autoComplete="name" />
          </Field>
        )}
        <Field label="E-mail">
          <input name="email" type="email" required className={inputClass} autoComplete="email" />
        </Field>
        <Field label="Senha">
          <input
            name="password"
            type="password"
            required
            minLength={isSignIn ? undefined : 8}
            className={inputClass}
            autoComplete={isSignIn ? "current-password" : "new-password"}
          />
        </Field>
        <FormMessage state={isSignIn ? signInState : signUpState} />
        <Button type="submit" disabled={signingIn || signingUp}>
          {isSignIn ? "Entrar" : "Criar conta"}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => setMode(isSignIn ? "signup" : "signin")}
        className="text-sm text-zinc-600 underline-offset-2 hover:underline"
      >
        {isSignIn ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}
      </button>
    </div>
  );
}
