import { timingSafeEqual } from "node:crypto";
import { retryPendingConversions } from "@/lib/conversions";
import { serverSecret } from "@/lib/server";

/**
 * Called every hour by netlify/functions/meta-retry.mts: resends the
 * conversions Meta still owes. Only the server secret opens it.
 */
export async function POST(request: Request) {
  const secret = serverSecret();
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret ?? "");
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Stays under the scheduled function's 30-second limit.
  const result = await retryPendingConversions(Date.now() + 20_000);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
