import "server-only";

/**
 * E-mail through Resend (https://resend.com). RESEND_API_KEY turns it on;
 * LH_MAIL_FROM is the sender, on a domain verified in Resend. Without a
 * verified domain Resend only delivers from onboarding@resend.dev to the
 * account owner's own address.
 */
export function mailReady() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(message: { to: string; subject: string; text: string; html: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.LH_MAIL_FROM || "Lead Hub <onboarding@resend.dev>", ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    // Status only: never log the address or the content.
    if (!response.ok) console.error(`mail: Resend answered ${response.status}`);
    return response.ok;
  } catch {
    console.error("mail: Resend unreachable");
    return false;
  }
}

/**
 * Base URL for links sent by e-mail. Taken only from the configuration, never
 * from the request, so a forged Host header cannot point a reset link at
 * another site.
 */
export function publicAppUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.URL;
  return url ? url.replace(/\/$/, "") : null;
}

export function resetPasswordEmail(link: string) {
  const subject = "Lead Hub: criar uma senha nova";
  const text = `Recebemos um pedido para criar uma senha nova no painel do Lead Hub.

Para criar a senha, abra este link (vale por 30 minutos e só pode ser usado uma vez):
${link}

Se não foi você, ignore este e-mail: sua senha continua a mesma.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18181b;max-width:480px">
<p>Recebemos um pedido para criar uma senha nova no painel do <strong>Lead Hub</strong>.</p>
<p><a href="${link}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Criar senha nova</a></p>
<p style="font-size:13px;color:#52525b">O link vale por 30 minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
</div>`;
  return { subject, text, html };
}
