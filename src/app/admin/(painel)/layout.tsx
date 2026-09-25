import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { adminLogout } from "../actions";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { login, role } = await requireAdmin();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-800 bg-zinc-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            Lead Hub · Painel mãe
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-300">
            <Link href="/admin" className="hover:text-white">
              Clientes
            </Link>
            <Link href="/admin/novo" className="hover:text-white">
              Novo cliente
            </Link>
            {role === "master" && (
              <Link href="/admin/gestores" className="hover:text-white">
                Gestores
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-300">
            <Link href="/admin/conta" className="hover:text-white" title="Minha conta">
              {login}
              <span className="ml-1.5 rounded bg-zinc-700 px-1.5 py-0.5 text-xs">{role === "master" ? "master" : "gestor"}</span>
            </Link>
            <form action={adminLogout}>
              <button className="hover:text-white hover:underline">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">{children}</main>
    </div>
  );
}
