"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sections of the painel mãe; the current one is highlighted. */
export function NavTabs({ master }: { master: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: "/admin", label: "Clientes", active: path === "/admin" || path.startsWith("/admin/clientes") },
    { href: "/admin/leads", label: "Leads", active: path.startsWith("/admin/leads") },
    { href: "/admin/novo", label: "Novo cliente", active: path.startsWith("/admin/novo") },
    ...(master ? [{ href: "/admin/gestores", label: "Gestores", active: path.startsWith("/admin/gestores") }] : []),
  ];
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 text-sm [scrollbar-width:none] md:mx-0 md:px-0 md:pb-0">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`shrink-0 rounded-full px-3 py-1.5 transition ${
            t.active ? "bg-white font-medium text-zinc-900" : "text-zinc-300 hover:bg-white/10 hover:text-white"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
