"use client";

import { PushButton } from "@/components/push-button";
import { pushSubscribe, pushTest, pushUnsubscribe } from "../actions";
import { usePanel } from "./panel-context";

/** New-lead notifications of this client on this device. */
export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const { slug } = usePanel();
  return (
    <PushButton
      vapidKey={vapidKey}
      subscribe={(s) => pushSubscribe(slug, s as never)}
      unsubscribe={(endpoint) => pushUnsubscribe(slug, endpoint)}
      test={(s) => pushTest(slug, s)}
      description="Receba uma notificação a cada lead novo, mesmo com o Cadê o Lead fechado. Responder rápido aumenta muito as vendas."
    />
  );
}
