"use server";

import { redirect } from "next/navigation";
import { slugify } from "@/lib/format";
import type { ActionState } from "@/lib/types";
import { requireUser } from "@/lib/workspace";

export async function createWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") || name));
  if (!name || !slug) return { error: "Informe o nome do workspace." };

  const { error } = await supabase.rpc("create_workspace", { p_name: name, p_slug: slug });
  if (error) {
    return { error: error.code === "23505" ? "Esse endereço já está em uso. Escolha outro." : "Não foi possível criar o workspace." };
  }
  redirect(`/w/${slug}/projects`);
}
