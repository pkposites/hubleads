"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import type { Page } from "@/lib/leads";
import { addPage, deleteClient, resetPassword, transferClient, updatePageSettings } from "../../../actions";
import { AccessCard } from "../../access-card";

export function ResetPassword({ origin, id, name, slug }: { origin: string; id: string; name: string; slug: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ password?: string; error?: string } | null>(null);
  if (result?.password) return <AccessCard origin={origin} name={name} slug={slug} password={result.password} />;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Gerar uma nova senha? Quem estiver usando a senha atual precisará entrar de novo.")) {
            start(async () => setResult(await resetPassword(id)));
          }
        }}
      >
        Gerar nova senha do atendente
      </Button>
      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
    </div>
  );
}

export function PageSettings({ workspaceId, page }: { workspaceId: string; page: Page }) {
  const [state, action, pending] = useActionState(updatePageSettings.bind(null, workspaceId, page.id), undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da Landing Page">
        <input name="name" defaultValue={page.name} className={inputClass} />
      </Field>
      <Field label="Domínios autorizados" hint="Separados por vírgula. Vazio aceita qualquer domínio (bom para testar).">
        <input name="domains" defaultValue={page.domains.join(", ")} placeholder="draleticia.com.br" className={inputClass} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="whatsapp_code" defaultChecked={page.whatsapp_code} />
        Incluir o código na mensagem do WhatsApp, por exemplo &quot;(cód. 7F3K)&quot;
      </label>
      <FormMessage state={state} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Salvar
      </Button>
    </form>
  );
}

export function AddPageForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(addPage.bind(null, workspaceId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Nova Landing Page">
        <input name="name" required placeholder="LP Black Friday" className={`${inputClass} w-56`} />
      </Field>
      <Field label="Domínio (opcional)">
        <input name="domains" placeholder="lp.cliente.com.br" className={`${inputClass} w-56`} />
      </Field>
      <Button type="submit" disabled={pending}>
        Adicionar
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/** Master only: which gestor manages this client ("" = the master). */
export function OwnerForm({
  workspaceId,
  ownerId,
  gestores,
}: {
  workspaceId: string;
  ownerId: string | null;
  gestores: { id: string; login: string }[];
}) {
  const [state, action, pending] = useActionState(transferClient.bind(null, workspaceId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Gestor responsável" hint="Só o gestor responsável (e você) vê este cliente no painel.">
        <select name="owner" defaultValue={ownerId ?? ""} className={`${inputClass} min-w-64`}>
          <option value="">Você (master)</option>
          {gestores.map((g) => (
            <option key={g.id} value={g.id}>
              {g.login}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/** Master only: deletes the client after typing its exact name and confirming. */
export function DeleteClient({ workspaceId, name, leads }: { workspaceId: string; name: string; leads: number }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteClient.bind(null, workspaceId), undefined);
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-zinc-600">Apaga o cliente, as Landing Pages, os leads e o histórico. Não tem como desfazer.</p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Apagar cliente...
        </Button>
      </div>
    );
  }
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Apagar "${name}" e ${leads} ${leads === 1 ? "lead" : "leads"} de vez? Não tem como desfazer.`)) e.preventDefault();
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">
        Isso apaga <strong>{name}</strong> por completo: Landing Pages (o código instalado nelas para de funcionar), {leads}{" "}
        {leads === 1 ? "lead" : "leads"}, histórico, métricas, configurações da Meta e o acesso do atendente. Se precisar dos dados,
        exporte a planilha antes.
      </p>
      <Field label={`Para confirmar, digite o nome do cliente: ${name}`}>
        <input
          name="confirm_name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={!matches || pending}>
          {pending ? "Apagando..." : "Apagar cliente de vez"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => {
            setOpen(false);
            setTyped("");
          }}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
