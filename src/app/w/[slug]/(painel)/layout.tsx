import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { logout } from "../actions";

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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Lead Hub</span>
          <span className="text-sm text-zinc-500">/</span>
          <span className="text-sm font-medium">{workspace.name}</span>
          <form action={logout.bind(null, slug)} className="ml-auto">
            <button className="text-sm text-zinc-600 hover:underline">Sair</button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
