"use client";

import { useActionState, useState } from "react";
import { Button, controlClass, FormMessage } from "@/components/ui";
import { createLead } from "../actions";

/** For WhatsApp contacts that did not come through a tracked click. */
export function NewLeadForm({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createLead.bind(null, slug), undefined);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Adicionar lead
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" placeholder="Nome" className={`${controlClass} w-40`} />
      <input name="phone" placeholder="Telefone" className={`${controlClass} w-40`} />
      <input name="notes" placeholder="Observação" className={`${controlClass} w-48`} />
      <Button type="submit" disabled={pending}>
        Salvar
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Fechar
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
