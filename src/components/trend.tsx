import type { Trend } from "@/lib/period";

/** "▲ 12%" in green, "▼ 8%" in red: change against the previous period. */
export function TrendLine({ trend, label }: { trend: Trend | null; label?: string }) {
  if (!trend) return null;
  const color = trend.direction === "up" ? "text-emerald-700" : trend.direction === "down" ? "text-red-700" : "text-zinc-500";
  return (
    <div className={`text-xs font-medium ${color}`} title={label ? `Comparado a ${label}` : undefined}>
      {trend.text}
    </div>
  );
}
