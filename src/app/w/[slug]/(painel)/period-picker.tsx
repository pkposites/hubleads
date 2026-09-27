"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass, controlClass } from "@/components/ui";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/period";

/**
 * Period of the page, at the top: changing it keeps the other filters in the
 * address (status, origem, busca, dimension) and is shared by the sheet, the
 * metrics and the export.
 */
export function PeriodPicker({
  period,
  from,
  to,
  rangeText,
  compareText,
}: {
  period: PeriodKey;
  from: string | null;
  to: string | null;
  rangeText: string;
  compareText: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<PeriodKey>(period);
  const [de, setDe] = useState(from ?? "");
  const [ate, setAte] = useState(to ?? "");

  const go = (values: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const key of ["periodo", "de", "ate"]) next.delete(key);
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-zinc-700">Período</span>
        <select
          value={choice}
          onChange={(e) => {
            const value = e.target.value as PeriodKey;
            setChoice(value);
            if (value !== "personalizado") go({ periodo: value });
          }}
          className={`${controlClass} flex-1 sm:w-44 sm:flex-none`}
          aria-label="Período"
          disabled={pending}
        >
          {Object.entries(PERIOD_OPTIONS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {choice === "personalizado" && (
        <form
          className="flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            go({ periodo: "personalizado", de, ate: ate || de });
          }}
        >
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} required className={controlClass} aria-label="De" />
          <span className="text-zinc-500">até</span>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={controlClass} aria-label="Até" />
          <button className={buttonClass("secondary")} disabled={pending || !de}>
            Aplicar
          </button>
        </form>
      )}

      <div className="text-xs text-zinc-500 sm:ml-auto sm:text-right">
        <span className="font-medium text-zinc-700">{pending ? "Carregando..." : rangeText}</span>
        {compareText && <span className="block">comparado a {compareText}</span>}
      </div>
    </div>
  );
}
