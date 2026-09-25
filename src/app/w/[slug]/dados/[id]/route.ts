import { call, DbError } from "@/lib/db";
import { currentSession } from "@/lib/session";

/** All data kept about one lead, for the person's LGPD request. Admin sessions only; recorded in the audit log. */
export async function GET(_request: Request, ctx: RouteContext<"/w/[slug]/dados/[id]">) {
  const { slug, id } = await ctx.params;
  const session = await currentSession();
  if (!session || session.workspace.slug !== slug) return new Response("Sessão expirada. Entre novamente.", { status: 401 });
  if (session.workspace.role !== "admin") return new Response("Só o administrador exporta dados pessoais.", { status: 403 });
  try {
    const data = await call<{ lead: { code: string } }>("lh_lead_export", { p_token: session.token, p_lead_id: id });
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="dados-lead-${data.lead.code}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const code = error instanceof DbError ? error.code : "";
    if (code === "LH404" || code === "22P02") return new Response("Lead não encontrado.", { status: 404 });
    if (code === "LH403") return new Response("Só o administrador exporta dados pessoais.", { status: 403 });
    throw error;
  }
}
