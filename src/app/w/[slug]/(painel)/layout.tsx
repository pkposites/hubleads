import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { logout } from "../actions";

export default async function PanelLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace(slug);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Lead Hub</span>
          <span className="text-sm text-zinc-500">/</span>
          <span className="text-sm font-medium">{workspace.name}</span>
          <nav className="flex gap-4 text-sm">
            <Link href={`/w/${slug}`} className="text-zinc-700 hover:text-zinc-950">
              Planilha
            </Link>
            <Link href={`/w/${slug}/eventos`} className="text-zinc-700 hover:text-zinc-950">
              Eventos
            </Link>
            <Link href={`/w/${slug}/instalacao`} className="text-zinc-700 hover:text-zinc-950">
              Instalação na LP
            </Link>
          </nav>
          <form action={logout.bind(null, slug)} className="ml-auto">
            <button className="text-sm text-zinc-600 hover:underline">Sair</button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
