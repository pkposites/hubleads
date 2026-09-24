"use client";

import { useState, useTransition } from "react";
import type { Stage } from "@/lib/types";
import { moveLeadStage } from "./actions";

interface Props {
  slug: string;
  leadId: string;
  currentStageId: string | null;
  stages: Stage[];
  disabled?: boolean;
}

/** Quick stage change (§13.2). Asks for the loss reason / sale value inline. */
export function StageSelect({ slug, leadId, currentStageId, stages, disabled }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const options: { lostReason?: string; saleValue?: number } = {};

    if (stage.kind === "lost") {
      const reason = window.prompt("Motivo da perda (obrigatório):")?.trim();
      if (!reason) return;
      options.lostReason = reason;
    }
    if (stage.kind === "won") {
      const raw = window.prompt("Valor da venda em R$ (opcional):", "")?.trim();
      if (raw === undefined) return;
      if (raw) {
        const value = Number(raw.replace(/\./g, "").replace(",", "."));
        if (!Number.isFinite(value) || value < 0) {
          setError("Valor inválido.");
          return;
        }
        options.saleValue = value;
      }
    }

    setError(null);
    startTransition(async () => {
      const result = await moveLeadStage(slug, leadId, stageId, options);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        aria-label="Estágio"
        value={currentStageId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || pending}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
      >
        {!currentStageId && <option value="">—</option>}
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </div>
  );
}
