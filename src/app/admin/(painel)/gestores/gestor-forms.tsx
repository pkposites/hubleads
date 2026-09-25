"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { createGestor, deactivateGestor, resetGestorPassword } from "../../actions";

function Credentials({ origin, login, password }: { origin: string; login: string; password: string }) {
  const text = `Acesso ao Lead Hub (painel de gestor)\nEndereço: ${origin}/admin\nE-mail: ${login}\nSenha: ${password}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-medium text-emerald-900">Envie estes dados ao gestor. A senha não aparece de novo.</p>
      <pre className="whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs">{text}</pre>
      <CopyButton text={text} label="Copiar acesso" />
    </div>
  );
}

export function CreateGestorForm({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState(createGestor, undefined);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label="E-mail do gestor">
            <input name="login" type="email" required placeholder="gestor@agencia.com" className={inputClass} />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Criando..." : "Criar acesso"}
        </Button>
      </form>
      <FormMessage state={state} />
      {state?.created && <Credentials origin={origin} login={state.created.login} password={state.created.password} />}
    </div>
  );
}

export function GestorActions({ id, login, active, origin }: { id: string; login: string; active: boolean; origin: string }) {
  const [pending, start] = useTransition();
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (password) {
    return (
      <div className="w-full">
        <Credentials origin={origin} login={login} password={password} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          const ask = active
            ? "Gerar nova senha? A senha atual deixa de funcionar e o gestor precisa entrar de novo."
            : "Reativar este gestor com uma nova senha?";
          if (!window.confirm(ask)) return;
          start(async () => {
            const r = await resetGestorPassword(id);
            setError(r.error ?? null);
            if (r.password) setPassword(r.password);
          });
        }}
      >
        {active ? "Nova senha" : "Reativar"}
      </Button>
      {active && (
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Desativar ${login}? Ele sai na hora e não consegue mais entrar. Os clientes dele continuam com você.`)) return;
            start(async () => setError((await deactivateGestor(id)).error ?? null));
          }}
        >
          Desativar
        </Button>
      )}
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
