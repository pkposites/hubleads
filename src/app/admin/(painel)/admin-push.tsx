"use client";

import { PushButton } from "@/components/push-button";
import type { AdminRole } from "@/lib/admin";
import { adminPushSubscribe, adminPushTest, adminPushUnsubscribe } from "../actions";

/** New-lead notifications of every client this admin manages, on this device. */
const WHOSE: Record<AdminRole, string> = {
  master: "todos os clientes",
  gestor: "todos os seus clientes",
  conta: "todos os clientes que você acessa",
};

export function AdminPush({ vapidKey, role }: { vapidKey: string | null; role: AdminRole }) {
  return (
    <PushButton
      vapidKey={vapidKey}
      subscribe={adminPushSubscribe}
      unsubscribe={adminPushUnsubscribe}
      test={adminPushTest}
      dark
      description={`Receba uma notificação a cada lead novo de ${WHOSE[role]} (landing page, formulário ou planilha), com o nome do cliente, mesmo com o Cadê o Lead fechado. Tocar no aviso abre o cliente.`}
    />
  );
}
