"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Reloads the data on screen (the installed app has no browser reload). */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      aria-label="Atualizar"
      title="Atualizar"
      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-zinc-700 transition hover:bg-zinc-100 active:scale-95 active:bg-zinc-200 sm:min-h-8 sm:min-w-8"
    >
      <svg
        viewBox="0 0 24 24"
        className={`size-5 ${pending ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
