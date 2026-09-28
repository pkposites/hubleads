"use client";

import { useState, type ReactNode } from "react";

export type AlertMode = "open" | "min" | "hide";

const TONE = {
  neutral: "border-zinc-200 bg-white",
  amber: "border-amber-300 bg-amber-50",
  red: "border-red-300 bg-red-50",
} as const;

/**
 * An alert of the painel mãe that can be minimised or hidden. The choice is
 * kept in a cookie (read by the server, so the page opens as left) and holds
 * only while the alert says the same thing: when `signature` changes, it
 * opens again.
 */
export function DismissibleAlert({
  id,
  signature,
  initialMode,
  tone,
  title,
  children,
}: {
  id: string;
  signature: string;
  initialMode: AlertMode;
  tone: keyof typeof TONE;
  title: ReactNode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<AlertMode>(initialMode);
  const choose = (next: AlertMode) => {
    setMode(next);
    const name = `lh_alert_${id}`;
    document.cookie =
      next === "open"
        ? `${name}=; path=/admin; max-age=0; samesite=lax`
        : `${name}=${next}.${signature}; path=/admin; max-age=31536000; samesite=lax`;
  };

  if (mode === "hide") return null;
  if (mode === "min") {
    return (
      <section className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${TONE[tone]}`}>
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className="flex shrink-0 items-center gap-3 text-xs">
          <button type="button" className="font-medium hover:underline" onClick={() => choose("open")}>
            Mostrar
          </button>
          <button type="button" className="text-zinc-500 hover:underline" onClick={() => choose("hide")}>
            Ocultar
          </button>
        </span>
      </section>
    );
  }
  return (
    <section className={`rounded-lg border p-4 text-sm ${TONE[tone]}`} role={tone === "neutral" ? undefined : "alert"}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex shrink-0 items-center gap-3 text-xs">
          <button type="button" className="font-medium hover:underline" onClick={() => choose("min")}>
            Minimizar
          </button>
          <button type="button" className="text-zinc-500 hover:underline" onClick={() => choose("hide")} title="Volta a aparecer quando a situação mudar">
            Ocultar até mudar
          </button>
        </span>
      </div>
      {children}
    </section>
  );
}
