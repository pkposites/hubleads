import Link from "next/link";
import { call } from "@/lib/db";
import type { Template } from "@/lib/leads";
import { vapidPublicKey } from "@/lib/push";
import { requireWorkspace } from "@/lib/session";
import { logout } from "../actions";
import { AutoRefresh } from "./auto-refresh";
import { NewLeadAlert } from "./new-lead-alert";
import { PanelProvider } from "./panel-context";
import { PanelNav } from "./panel-nav";
import { PushToggle } from "./push-toggle";

export default async function PanelLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const { token, workspace } = await requireWorkspace(slug);
  const asAdmin = workspace.role === "admin";
  const [templates, counts] = await Promise.all([
    call<Template[]>("lh_list_templates", { p_token: token }),
    call<{ waiting: number; due: number; latest: string | null }>("lh_queue_count", { p_token: token }),
  ]);

  return (
    <PanelProvider value={{ slug, company: workspace.name, templates, isAdmin: asAdmin }}>
      <div className="flex flex-1 flex-col">
        <AutoRefresh />
        <NewLeadAlert latest={counts.latest} waiting={counts.waiting} />
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
            <div className="ml-auto flex items-center gap-1 sm:order-last">
              <PushToggle vapidKey={vapidPublicKey()} />
              <form action={logout.bind(null, slug)}>
                <button className="px-2 py-1.5 text-sm text-zinc-600 hover:underline">Sair</button>
              </form>
            </div>
            <div className="-mx-3 w-[calc(100%+1.5rem)] overflow-x-auto px-3 sm:mx-0 sm:w-auto sm:px-0">
              <PanelNav slug={slug} queue={counts.waiting + counts.due} />
            </div>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-4">{children}</main>
      </div>
    </PanelProvider>
  );
}
