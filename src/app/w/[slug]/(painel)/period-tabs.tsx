import Link from "next/link";

/** Pill links: easy to tap on a phone, and the state lives in the URL. */
export function PillLinks({
  options,
  active,
  href,
  label,
}: {
  options: Record<string, string>;
  active: string;
  href: (key: string) => string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {Object.entries(options).map(([key, text]) => (
        <Link
          key={key}
          href={href(key)}
          aria-current={key === active ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
            key === active
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
}
