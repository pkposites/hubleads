import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role, Workspace } from "@/lib/types";

/** The signed-in user, or a redirect to /login. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return { supabase, userId, email: (data.claims.email as string | undefined) ?? null };
});

/**
 * Loads a workspace the user belongs to. RLS already hides other workspaces,
 * so "not a member" and "does not exist" both end in a 404.
 */
export const getWorkspaceContext = cache(async (slug: string) => {
  const { supabase, userId, email } = await requireUser();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle<Workspace>();
  if (!workspace) notFound();

  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", userId)
    .maybeSingle<{ role: Role }>();
  if (!member) notFound();

  return { supabase, userId, email, workspace, role: member.role };
});
