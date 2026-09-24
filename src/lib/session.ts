import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { call, DbError } from "@/lib/db";

export const SESSION_COOKIE = "lh_session";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

/** The workspace of the current session, or null when there is none. */
export const currentSession = cache(async (): Promise<{ token: string; workspace: Workspace } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const workspace = await call<Workspace | null>("lh_session", { p_token: token });
    return workspace ? { token, workspace } : null;
  } catch (error) {
    if (error instanceof DbError && error.code === "LH401") return null;
    throw error;
  }
});

/** Session for the workspace in the URL, or a redirect to its password page. */
export async function requireWorkspace(slug: string) {
  const session = await currentSession();
  if (!session || session.workspace.slug !== slug) redirect(`/w/${slug}/entrar`);
  return session;
}
