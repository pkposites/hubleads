"use server";

import { revalidatePath } from "next/cache";
import { getWorkspaceContext } from "@/lib/workspace";

export async function moveLeadStage(
  slug: string,
  leadId: string,
  stageId: string,
  options: { lostReason?: string; saleValue?: number } = {},
): Promise<{ error?: string }> {
  const { supabase } = await getWorkspaceContext(slug);
  const { error } = await supabase.rpc("move_lead_stage", {
    p_lead_id: leadId,
    p_to_stage_id: stageId,
    p_lost_reason: options.lostReason ?? null,
    p_sale_value: options.saleValue ?? null,
  });

  if (error) {
    if (error.code === "P0002") return { error: "Lead não encontrado ou sem permissão." };
    if (error.code === "22023") {
      return {
        error: error.message.includes("lost_reason") ? "Informe o motivo da perda." : "Mudança de estágio inválida.",
      };
    }
    return { error: "Não foi possível mudar o estágio." };
  }

  revalidatePath(`/w/${slug}/leads`);
  revalidatePath(`/w/${slug}/leads/${leadId}`);
  return {};
}
