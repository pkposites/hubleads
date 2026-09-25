import type { ComponentProps, ReactNode } from "react";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export const buttonClass = (variant: "primary" | "secondary" | "danger" = "primary") =>
  cx(
    // Taller on phones so every button is an easy tap target.
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition sm:min-h-0 sm:py-1.5",
    "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
    variant === "primary" && "bg-zinc-900 text-white hover:bg-zinc-700",
    variant === "secondary" && "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  );

export function Button({
  variant,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button className={cx(buttonClass(variant), className)} {...props} />;
}

/** Input styling without a width, for inline controls such as filters. */
// 16px text on phones keeps iOS from zooming in when a field gets focus.
export const controlClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-base shadow-xs placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none sm:py-1.5 sm:text-sm";

export const inputClass = `w-full ${controlClass}`;

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-zinc-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "good" | "bad"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-zinc-100 text-zinc-700",
        tone === "warn" && "bg-amber-100 text-amber-800",
        tone === "good" && "bg-emerald-100 text-emerald-800",
        tone === "bad" && "bg-red-100 text-red-800",
      )}
    >
      {children}
    </span>
  );
}

export function FormMessage({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (state?.error) return <p className="text-sm text-red-700" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-emerald-700" role="status">{state.ok}</p>;
  return null;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-zinc-900">{title}</p>
      {children && <div className="mt-2 text-sm text-zinc-600">{children}</div>}
    </div>
  );
}
