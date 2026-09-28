"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/app/w/[slug]/(painel)/bottom-sheet";

type Keys = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

type State = "loading" | "unsupported" | "ios-install" | "off" | "on" | "denied";

function base64ToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * Turns new-lead notifications on this device on or off. The caller says
 * where the device is registered (a client's panel or the painel mãe).
 */
export function PushButton({
  vapidKey,
  subscribe,
  unsubscribe,
  description,
  dark = false,
}: {
  vapidKey: string | null;
  subscribe: (subscription: Keys) => Promise<{ error?: string }>;
  unsubscribe: (endpoint: string) => Promise<unknown>;
  description: string;
  dark?: boolean;
}) {
  const [state, setState] = useState<State>("loading");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      if (!vapidKey || !("serviceWorker" in navigator)) return setState("unsupported");
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("PushManager" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        // Keeps the server copy fresh (and linked to this panel).
        await subscribe(existing.toJSON() as Keys);
      }
      setState(existing ? "on" : "off");
    };
    check().catch(() => setState("unsupported"));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per key: the caller passes new callbacks on every render
  }, [vapidKey]);

  const enable = async () => {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(vapidKey!),
      });
      const result = await subscribe(subscription.toJSON() as Keys);
      if (result.error) throw new Error(result.error);
      setState("on");
      setOpen(false);
    } catch {
      setError("Não foi possível ativar os avisos neste aparelho.");
    }
  };

  const disable = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await unsubscribe(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setState("off");
    setOpen(false);
  };

  if (state === "loading" || state === "unsupported") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={state === "on" ? "Avisos ativos" : "Ativar avisos"}
        className={`inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm transition active:scale-95 sm:min-h-8 ${
          dark
            ? state === "on"
              ? "text-emerald-400"
              : "text-zinc-300 hover:bg-zinc-800"
            : state === "on"
              ? "text-emerald-700"
              : "text-zinc-600 hover:bg-zinc-100"
        }`}
      >
        <span aria-hidden>{state === "on" ? "🔔" : "🔕"}</span>
        <span className="hidden sm:inline">{state === "on" ? "Avisos ativos" : "Ativar avisos"}</span>
      </button>
      {open && (
        <BottomSheet title="Avisos de novo lead" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 text-sm text-zinc-900">
            {state === "on" && (
              <>
                <p>Avisos ativos neste aparelho. {description}</p>
                <button type="button" onClick={disable} className="self-start text-red-700 hover:underline">
                  Desativar neste aparelho
                </button>
              </>
            )}
            {state === "off" && (
              <>
                <p>{description}</p>
                <button type="button" onClick={enable} className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 font-medium text-white">
                  Ativar avisos neste aparelho
                </button>
              </>
            )}
            {state === "ios-install" && (
              <ol className="list-decimal space-y-1 pl-5">
                <li>No Safari, toque em Compartilhar (quadrado com a seta).</li>
                <li>Escolha &quot;Adicionar à Tela de Início&quot;.</li>
                <li>Abra o Lead Hub pelo ícone e toque em &quot;Ativar avisos&quot;.</li>
              </ol>
            )}
            {state === "denied" && (
              <p>As notificações estão bloqueadas para este site. Libere nas configurações do navegador e recarregue a página.</p>
            )}
            {error && <p className="text-red-700">{error}</p>}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
