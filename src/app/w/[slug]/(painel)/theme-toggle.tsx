"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const KEY = "lh_theme";
const NEXT: Record<Theme, Theme> = { system: "dark", dark: "light", light: "system" };
const LABEL: Record<Theme, string> = { system: "Tema do aparelho", dark: "Tema escuro", light: "Tema claro" };

/** Runs before the panel paints, so a chosen theme does not flash the other one. */
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.currentScript.parentElement.setAttribute("data-theme",t)}catch(e){}`;

function apply(theme: Theme) {
  const panel = document.querySelector(".lh-panel");
  if (!panel) return;
  if (theme === "system") panel.removeAttribute("data-theme");
  else panel.setAttribute("data-theme", theme);
}

// The chosen theme lives on the panel element (set before paint by themeScript).
const read = (): Theme => {
  const t = document.querySelector(".lh-panel")?.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
};
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Light, dark or the phone's own setting; remembered on this device. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const change = () => {
    const next = NEXT[theme];
    apply(next);
    listeners.forEach((fn) => fn());
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: applied now, not remembered.
    }
  };
  return (
    <button
      type="button"
      onClick={change}
      title={`${LABEL[theme]} (toque para trocar)`}
      aria-label={`${LABEL[theme]}. Trocar tema`}
      className="grid size-9 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          <path d="M16.5 12.2A6.5 6.5 0 0 1 7.8 3.5a6.5 6.5 0 1 0 8.7 8.7Z" />
        ) : theme === "light" ? (
          <>
            <circle cx="10" cy="10" r="3.2" />
            <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
          </>
        ) : (
          <>
            <circle cx="10" cy="10" r="6.5" />
            <path d="M10 3.5v13a6.5 6.5 0 0 0 0-13Z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}
