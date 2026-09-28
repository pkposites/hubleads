import { timingSafeEqual } from "node:crypto";
import { syncMetaForms } from "@/lib/meta-lead-sync";
import { serverSecret } from "@/lib/server";

/**
 * Called every minute by netlify/functions/meta-leads.mts: imports the new
 * leads of the connected Meta forms. Only the server secret opens it.
 */
export async function POST(request: Request) {
  const secret = serverSecret();
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret ?? "");
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Stays under the scheduled function's 30-second limit.
  const result = await syncMetaForms(Date.now() + 20_000);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
