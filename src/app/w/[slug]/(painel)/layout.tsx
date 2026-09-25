import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { logout } from "../actions";
import { PanelNav } from "./panel-nav";

export default async function PanelLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);
  const asAdmin = workspace.role === "admin";

  return (
    <div className="flex flex-1 flex-col">
      {asAdmin && (
        <div className="flex items-center justify-between gap-3 bg-zinc-900 px-4 py-1.5 text-xs text-zinc-200">
          <span>Você está vendo a planilha como administrador.</span>
          <Link href={`/admin/clientes/${workspace.id}`} className="font-medium text-white hover:underline">
            ← Voltar ao painel mãe
          </Link>
        </div>
      )}
      <header className="border-b border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold">Lead Hub</span>
            <span className="text-sm text-zinc-400">/</span>
            <span className="truncate text-sm font-medium">{workspace.name}</span>
          </div>
          <form action={logout.bind(null, slug)} className="ml-auto sm:order-last">
            <button className="px-2 py-1.5 text-sm text-zinc-600 hover:underline">Sair</button>
          </form>
          <div className="w-full sm:w-auto">
            <PanelNav slug={slug} />
          </div>
        </div>
      </header>
      <main className="flex-1 p-3 sm:p-4">{children}</main>
    </div>
  );
}
