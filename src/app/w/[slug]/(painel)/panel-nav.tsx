"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function PanelNav({ slug, queue }: { slug: string; queue: number }) {
  const pathname = usePathname();
  // The tapped tab lights up at once, before the page arrives.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const current = tapped && tapped.from === pathname ? tapped.href : pathname;
  const tabs = [
    { href: `/w/${slug}/atender`, label: "Atender", badge: queue },
    { href: `/w/${slug}`, label: "Planilha" },
    { href: `/w/${slug}/metricas`, label: "Métricas" },
    { href: `/w/${slug}/mensagens`, label: "Mensagens" },
  ];
  return (
    <nav className="flex gap-1" aria-label="Seções">
      {tabs.map((t) => {
        const active = current === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            onClick={() => t.href !== pathname && setTapped({ href: t.href, from: pathname })}
            aria-current={pathname === t.href ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm transition active:scale-95 sm:py-1.5 ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
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
