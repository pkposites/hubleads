import Link from "next/link";
import { resetDemo } from "@/app/demo-actions";
import { isDemoMode } from "@/lib/demo/mode";
import { ROLE_LABELS } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { workspace, role, email } = await getWorkspaceContext(slug);
  const demo = isDemoMode();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold">
            Lead Hub
          </Link>
          <span className="text-sm text-zinc-500">/</span>
          <span className="text-sm font-medium">{workspace.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link href={`/w/${slug}/leads`} className="text-zinc-700 hover:text-zinc-950">
              Leads
            </Link>
            <Link href={`/w/${slug}/projects`} className="text-zinc-700 hover:text-zinc-950">
              Projetos
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-600">
            {demo ? (
              <>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Demonstração · dados de exemplo
                </span>
                <form action={resetDemo}>
                  <button className="hover:underline">Reiniciar dados</button>
                </form>
              </>
            ) : (
              <>
                <span>
                  {email} · {ROLE_LABELS[role]}
                </span>
                <form action="/auth/signout" method="post">
                  <button className="hover:underline">Sair</button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">{children}</main>
    </div>
  );
}
