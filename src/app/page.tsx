import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_WORKSPACE_SLUG } from "@/lib/demo/seed";
import { ROLE_LABELS, type Role, type Workspace } from "@/lib/types";
import { requireUser } from "@/lib/workspace";
import { CreateWorkspaceForm } from "./create-workspace-form";

export default async function Home() {
  if (isDemoMode()) redirect(`/w/${DEMO_WORKSPACE_SLUG}/leads`);

  const { supabase, userId, email } = await requireUser();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces (id, name, slug)")
    .eq("user_id", userId)
    .order("created_at");
  const memberships = (data ?? []) as unknown as { role: Role; workspaces: Workspace }[];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Lead Hub</h1>
          <p className="text-sm text-zinc-600">{email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="text-sm text-zinc-600 hover:underline">Sair</button>
        </form>
      </header>

      <Card title="Seus workspaces">
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error.code === "PGRST106"
              ? "O banco não está liberando o esquema leadhub. No Supabase, adicione leadhub em Project Settings → Data API → Exposed schemas."
              : "Não foi possível carregar seus workspaces. Tente novamente em instantes."}
          </p>
        ) : memberships.length === 0 ? (
          <p className="text-sm text-zinc-600">Você ainda não participa de nenhum workspace. Crie o primeiro abaixo.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {memberships.map(({ role, workspaces: ws }) => (
              <li key={ws.id}>
                <Link href={`/w/${ws.slug}/leads`} className="flex items-center justify-between py-2.5 hover:underline">
                  <span className="font-medium">{ws.name}</span>
                  <span className="text-xs text-zinc-500">{ROLE_LABELS[role]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Novo workspace">
        <CreateWorkspaceForm />
      </Card>
    </main>
  );
}
