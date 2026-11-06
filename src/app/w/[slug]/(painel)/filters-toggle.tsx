"use client";

import { useState, type ReactNode } from "react";

/** On phones the filters fold behind one button (open when a filter is set); larger screens always show them. */
export function FiltersToggle({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active);
  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-800 shadow-xs sm:hidden"
      >
        {active ? "Filtros ativos" : "Filtros"}
        <svg aria-hidden viewBox="0 0 20 20" className={`size-4 text-zinc-400 transition ${open ? "rotate-180" : ""}`}>
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`${open ? "mt-2 block" : "hidden"} sm:mt-0 sm:block`}>{children}</div>
    </div>
  );
}
