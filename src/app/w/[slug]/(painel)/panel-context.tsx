"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Template } from "@/lib/leads";

interface Panel {
  slug: string;
  company: string;
  templates: Template[];
  isAdmin: boolean;
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
