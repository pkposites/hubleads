"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { fillTemplate, type Template } from "@/lib/leads";
import { deleteTemplate, saveTemplate } from "../../actions";

export function TemplatePreview({ template, company }: { template: Template; company: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-sm font-medium">{template.name}</div>
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm">{fillTemplate(template.body, { name: "Maria", company })}</p>
    </div>
  );
}

export function TemplateEditor({ slug, template, nextPosition = 99 }: { slug: string; template: Template | null; nextPosition?: number }) {
  const [state, action, pending] = useActionState(saveTemplate.bind(null, slug, template?.id ?? null), undefined);
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      {!template && <h2 className="text-sm font-semibold">Nova mensagem</h2>}
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <Field label="Nome">
          <input name="name" required maxLength={60} defaultValue={template?.name} placeholder="Ex.: Pós-consulta" className={inputClass} />
        </Field>
        <Field label="Ordem">
          <input name="position" type="number" min={0} defaultValue={template?.position ?? nextPosition} className={inputClass} />
        </Field>
      </div>
      <Field label="Mensagem">
        <textarea
          name="body"
          required
          maxLength={1000}
          rows={3}
          defaultValue={template?.body}
          placeholder="Olá, {nome}! ..."
          className={inputClass}
        />
      </Field>
      <FormMessage state={state} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={template ? "secondary" : "primary"} disabled={pending}>
          {pending ? "Salvando..." : template ? "Salvar" : "Adicionar mensagem"}
        </Button>
        {template && (
          <button
            type="button"
            disabled={deleting}
            className="text-sm text-red-700 hover:underline"
            onClick={() => {
              if (!window.confirm(`Excluir a mensagem "${template.name}"?`)) return;
              startDelete(async () => setError((await deleteTemplate(slug, template.id)).error ?? null));
            }}
          >
            Excluir
          </button>
        )}
      </div>
    </form>
  );
}
