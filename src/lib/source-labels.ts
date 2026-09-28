// Where a lead came from (lh_leads.source), in Portuguese.

export const SOURCE_LABELS = {
  lp: "Landing Page",
  meta_form: "Formulário Meta",
  sheets: "Planilha",
  manual: "Manual",
} as const;

export type LeadSourceKind = keyof typeof SOURCE_LABELS;

export const sourceLabel = (source: string | null | undefined) =>
  (source && SOURCE_LABELS[source as LeadSourceKind]) || "Outra";
