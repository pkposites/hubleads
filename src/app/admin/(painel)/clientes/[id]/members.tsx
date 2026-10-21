"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { formatDateTime } from "@/lib/format";
import { addMember, removeMember, resetMemberPassword } from "../../../actions";

export interface Member {
  id: string;
  login: string;
  active: boolean;
  since: string;
  last_login_at: string | null;
}

function Credentials({ origin, client, login, password }: { origin: string; client: string; login: string; password: string }) {
  const text = `Acesso ao Cadê o Lead (${client})\nEndereço: ${origin}/admin\nE-mail: ${login}\nSenha: ${password}\nNo primeiro acesso, troque a senha em "Minha conta".`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-medium text-emerald-900">Envie estes dados à pessoa. A senha não aparece de novo.</p>
      <pre className="whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs">{text}</pre>
      <CopyButton text={text} label="Copiar acesso" />
    </div>
  );
}

/** People of the client who set up and follow this account (and only the accounts given to them). */
export function Members({ workspaceId, client, origin, members }: { workspaceId: string; client: string; origin: string; members: Member[] }) {
  const [state, action, pending] = useActionState(addMember.bind(null, workspaceId), undefined);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-zinc-600">
        Quem entra aqui configura e acompanha <strong>só este cliente</strong> (e outros que você liberar para o mesmo e-mail): Landing Pages,
        fontes de leads, Meta, Google Ads e a planilha. Não vê seus outros clientes, não cria clientes e não dá acesso a ninguém.
      </p>
      {members.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {members.map((m) => (
            <MemberRow key={m.id} workspaceId={workspaceId} client={client} origin={origin} member={m} />
          ))}
        </ul>
      )}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Field label="E-mail da pessoa">
            <input name="login" type="email" required placeholder="nome@empresa.com" className={inputClass} />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Liberando..." : "Dar acesso a este cliente"}
        </Button>
      </form>
      <FormMessage state={state} />
      {state?.created &&
        (state.created.password ? (
          <Credentials origin={origin} client={client} login={state.created.login} password={state.created.password} />
        ) : (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
            {state.created.login} já tinha acesso ao Cadê o Lead: agora vê também este cliente, com a mesma senha.
          </p>
        ))}
    </div>
  );
}

function MemberRow({ workspaceId, client, origin, member }: { workspaceId: string; client: string; origin: string; member: Member }) {
  const [pending, start] = useTransition();
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{member.login}</p>
          <p className="text-xs text-zinc-500">
            Acesso desde {formatDateTime(member.since)} · último acesso: {member.last_login_at ? formatDateTime(member.last_login_at) : "nunca entrou"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Gerar nova senha? A senha atual deixa de funcionar na hora.")) return;
              start(async () => {
                const result = await resetMemberPassword(workspaceId, member.id);
                setError(result.error ?? null);
                setPassword(result.password ?? null);
              });
            }}
          >
            Nova senha
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Tirar o acesso de ${member.login} a este cliente? Vale na hora.`)) return;
              start(async () => {
                const result = await removeMember(workspaceId, member.id);
                setError(result.error ?? null);
              });
            }}
          >
            Tirar acesso
          </Button>
        </div>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      {password && <Credentials origin={origin} client={client} login={member.login} password={password} />}
    </li>
  );
}
