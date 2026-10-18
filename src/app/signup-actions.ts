"use server";

import { z } from "zod";
import { call, DbError } from "@/lib/db";
import { loginClient, serverSecret } from "@/lib/server";

export type SignupState = { ok?: boolean; error?: string } | undefined;

const CHANNELS = ["lp", "meta_form", "sheets", "whatsapp_direto", "google", "nao_anuncia"] as const;

const schema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  company: z.string().trim().min(2, "Informe a empresa ou agência.").max(120),
  whatsapp: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Informe um WhatsApp com DDD."),
  email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.").max(200)]),
  profile: z.enum(["agencia", "negocio", "outro"]),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
  message: z.string().trim().max(1000),
});

/** "Quero usar" form on the home page: stores the request for the master to get in touch. */
export async function requestSignup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  // Bots fill every field, people never see this one.
  if (String(formData.get("site") ?? "")) return { ok: true };
  const parsed = schema.safeParse({
    name: formData.get("name") ?? "",
    company: formData.get("company") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    email: formData.get("email") ?? "",
    profile: formData.get("profile") ?? "outro",
    channels: formData.getAll("channels"),
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confira os campos." };
  const secret = serverSecret();
  if (!secret) return { error: "Não foi possível enviar agora. Tente de novo mais tarde." };
  try {
    const result = await call<{ ok?: boolean; limited?: boolean }>("lh_server_signup", {
      p_secret: secret,
      p_client: (await loginClient()) ?? "",
      p_data: parsed.data,
    });
    if (result.limited) return { error: "Recebemos vários pedidos deste aparelho. Tente de novo em uma hora." };
    return { ok: true };
  } catch (error) {
    if (error instanceof DbError && error.code === "22023") return { error: "Confira os campos." };
    return { error: "Não foi possível enviar agora. Tente de novo mais tarde." };
  }
}
