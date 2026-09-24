"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  // Only same-site relative paths.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: "E-mail ou senha inválidos." };
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password,
    options: {
      data: { full_name: String(formData.get("full_name") ?? "").trim() },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/");
  return { ok: "Conta criada. Confirme pelo link enviado ao seu e-mail." };
}
