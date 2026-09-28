"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Template } from "@/lib/leads";
import type { SheetColumn } from "@/lib/sheet-columns";

interface Panel {
  slug: string;
  company: string;
  templates: Template[];
  isAdmin: boolean;
  /** Sheet columns in display order (answers, added columns, standard ones). */
  columns: SheetColumn[];
  /** Answers found in recent leads, for the column settings. */
  answers: { key: string; leads: number }[];
  stages: string[];
  meta: { schedule: boolean; purchase: boolean };
}

const PanelContext = createContext<Panel | null>(null);

export function PanelProvider({ value, children }: { value: Panel; children: ReactNode }) {
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanel() {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error("usePanel outside PanelProvider");
  return panel;
}
