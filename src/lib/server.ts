import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { clientIp } from "@/lib/collect";
import { parseKey } from "@/lib/crypto";

/**
 * Secret the app's server uses to call the lh_server_* functions (push
 * targets, Meta token). Set with `select lh_private.set_server_secret(...)`
 * in the database and LH_SERVER_SECRET in the host. Without it those
 * features stay off and everything else keeps working.
 */
export function serverSecret(): string | null {
  const secret = process.env.LH_SERVER_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/** Key that encrypts secrets saved in the database (see src/lib/crypto.ts). */
export function encryptionKey(): Buffer | null {
  return parseKey(process.env.LH_ENCRYPTION_KEY);
}

/**
 * Identifies the device trying to log in, for the login limits: a keyed hash
 * of its IP, so the database never stores the address itself.
 */
export async function loginClient(): Promise<string | null> {
  const ip = clientIp(new Request("https://x", { headers: await headers() }));
  if (!ip) return null;
  return createHmac("sha256", serverSecret() ?? "lead-hub-login").update(ip).digest("hex").slice(0, 32);
}

/** "Muitas tentativas..." message for a locked login. */
export function lockedMessage(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Muitas tentativas erradas. Por segurança, tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}
