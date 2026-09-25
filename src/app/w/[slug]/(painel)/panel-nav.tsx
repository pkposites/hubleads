"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PanelNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/w/${slug}`, label: "Planilha" },
    { href: `/w/${slug}/metricas`, label: "Métricas" },
  ];
  return (
    <nav className="flex gap-1" aria-label="Seções">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
