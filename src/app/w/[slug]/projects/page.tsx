import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { canManage, type Project } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";
import { CreateProjectForm } from "./create-project-form";

export default async function ProjectsPage({ params }: PageProps<"/w/[slug]/projects">) {
  const { slug } = await params;
  const { supabase, workspace, role } = await getWorkspaceContext(slug);
  const { data } = await supabase
    .from("projects")
    .select("id, workspace_id, name, slug, status, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at");
  const projects = (data ?? []) as Project[];

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Projetos</h1>
        {projects.length === 0 ? (
          <EmptyState title="Nenhum projeto ainda">
            Um projeto separa operações do mesmo cliente, como profissionais, unidades ou serviços.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/w/${slug}/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50">
                  <span className="font-medium">{p.name}</span>
                  {p.status === "archived" && <Badge>Arquivado</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canManage(role) && (
        <Card title="Novo projeto" className="self-start">
          <CreateProjectForm slug={slug} />
        </Card>
      )}
    </div>
  );
}
