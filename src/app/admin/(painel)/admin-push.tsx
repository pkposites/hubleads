"use client";

import { PushButton } from "@/components/push-button";
import { adminPushSubscribe, adminPushUnsubscribe } from "../actions";

/** New-lead notifications of every client this admin manages, on this device. */
export function AdminPush({ vapidKey, master }: { vapidKey: string | null; master: boolean }) {
  return (
    <PushButton
      vapidKey={vapidKey}
      subscribe={adminPushSubscribe}
      unsubscribe={adminPushUnsubscribe}
      dark
      description={`Receba uma notificação a cada lead novo de ${master ? "todos os clientes" : "todos os seus clientes"} (landing page, formulário ou planilha), com o nome do cliente, mesmo com o Lead Hub fechado. Tocar no aviso abre o cliente.`}
    />
  );
}
