import Link from "next/link";
import { requireAdmin, ROLE_LABEL } from "@/lib/admin";
import { vapidPublicKey } from "@/lib/push";
import { adminLogout } from "../actions";
import { AdminPush } from "./admin-push";
import { NavTabs } from "./nav-tabs";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { login, role } = await requireAdmin();
  const initial = login.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-900/95 text-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pt-3 md:flex-row md:items-center md:gap-6 md:pb-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/admin" className="flex items-center gap-2 font-semibold">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-500 text-sm text-zinc-900">C</span>
              <span>
                Cadê o Lead <span className="hidden font-normal text-zinc-400 sm:inline">· Painel mãe</span>
              </span>
            </Link>
            <div className="flex items-center gap-2 md:hidden">
              {role !== "conta" && <AdminPush vapidKey={vapidPublicKey()} master={role === "master"} />}
              <Link
                href="/admin/conta"
                title={`${login} (${role})`}
                className="grid size-8 place-items-center rounded-full bg-zinc-700 text-sm font-medium"
              >
                {initial}
              </Link>
            </div>
          </div>
          <NavTabs role={role} />
          <div className="ml-auto hidden items-center gap-3 text-sm text-zinc-300 md:flex">
            {role !== "conta" && <AdminPush vapidKey={vapidPublicKey()} master={role === "master"} />}
            <Link href="/admin/conta" className="flex items-center gap-2 hover:text-white" title="Minha conta">
              <span className="grid size-7 place-items-center rounded-full bg-zinc-700 text-xs font-medium text-white">{initial}</span>
              <span className="max-w-48 truncate">{login}</span>
              <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs">{ROLE_LABEL[role]}</span>
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
