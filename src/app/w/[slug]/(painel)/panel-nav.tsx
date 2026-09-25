"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PanelNav({ slug, queue }: { slug: string; queue: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/w/${slug}/atender`, label: "Atender", badge: queue },
    { href: `/w/${slug}`, label: "Planilha" },
    { href: `/w/${slug}/metricas`, label: "Métricas" },
    { href: `/w/${slug}/mensagens`, label: "Mensagens" },
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
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
          >
            {t.label}
            {t.badge ? (
              <span
                className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${active ? "bg-white text-zinc-900" : "bg-red-600 text-white"}`}
                aria-label={`${t.badge} aguardando`}
              >
                {t.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
