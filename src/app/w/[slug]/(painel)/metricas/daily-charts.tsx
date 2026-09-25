"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatRate, rate } from "@/lib/leads";

// Two single-series charts on purpose (never one chart with two y-axes):
// visitors per day as columns, conversion rate per day as a line.

const SERIES = "#2a78d6";
const GRID = "#e1e0d9";
const BASELINE = "#c3c2b7";
const MUTED = "#898781";
const HEIGHT = 180;
const PAD = { top: 16, right: 12, bottom: 24, left: 36 };

interface Day {
  day: string;
  visitors: number;
  clickers: number;
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

function niceMax(value: number) {
  if (value <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= value / 1) ?? 10;
  return Math.ceil(value / (step * pow)) * step * pow;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Tooltip({ day, x, width }: { day: Day; x: number; width: number }) {
  const left = Math.min(Math.max(x - 80, 0), Math.max(width - 160, 0));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-40 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md"
      style={{ left }}
    >
      <div className="font-medium text-zinc-900">{shortDate(day.day)}</div>
      <div className="flex justify-between text-zinc-600">
        <span>Visitantes</span>
        <span className="tabular-nums text-zinc-900">{day.visitors}</span>
      </div>
      <div className="flex justify-between text-zinc-600">
        <span>Clicaram</span>
        <span className="tabular-nums text-zinc-900">{day.clickers}</span>
      </div>
      <div className="flex justify-between text-zinc-600">
        <span>Conversão</span>
        <span className="tabular-nums text-zinc-900">{formatRate(rate(day.clickers, day.visitors))}</span>
      </div>
    </div>
  );
}

function Chart({
  days,
  kind,
  title,
}: {
  days: Day[];
  kind: "visitors" | "rate";
  title: string;
}) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(days.length, 1);
  const values = days.map((d) => (kind === "visitors" ? d.visitors : rate(d.clickers, d.visitors)));
  const max = kind === "visitors" ? niceMax(Math.max(...values.map((v) => v ?? 0), 1)) : niceMax(Math.max(...values.map((v) => v ?? 0), 10));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const cx = (i: number) => PAD.left + band * i + band / 2;
  const ticks = [0, max / 2, max];
  const fmt = (v: number) =>
    kind === "rate" ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : Math.round(v).toLocaleString("pt-BR");
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - PAD.left) / band);
    setActive(i >= 0 && i < days.length ? i : null);
  };
  const labelIdx = days.length <= 1 ? [0] : [0, Math.floor((days.length - 1) / 2), days.length - 1];

  const bar = (i: number, v: number) => {
    const w = Math.min(24, Math.max(band - 2, 2));
    const x = cx(i) - w / 2;
    const top = y(v);
    const base = PAD.top + plotH;
    if (v <= 0) return null;
    const r = Math.min(4, w / 2, base - top);
    return (
      <path
        key={i}
        d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`}
        fill={SERIES}
        opacity={active === null || active === i ? 1 : 0.45}
      />
    );
  };

  // Line segments break where a day had no visitors (no rate to show).
  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = "";
    } else {
      current += `${current ? "L" : "M"}${cx(i)},${y(v)}`;
    }
  });
  if (current) segments.push(current);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-zinc-900">{title}</figcaption>
      <div ref={ref} className="relative w-full select-none" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={title}
            onPointerMove={(e) => pick(e)}
            // A tap on a phone never "moves": select on press, and keep the
            // tooltip after the finger lifts (touch fires leave right away).
            onPointerDown={(e) => pick(e)}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch") setActive(null);
            }}
            className="touch-pan-y"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED}>
                  {fmt(t)}
                </text>
              </g>
            ))}
            {labelIdx.map((i) => (
              <text key={i} x={cx(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={11} fill={MUTED}>
                {shortDate(days[i].day)}
              </text>
            ))}
            {active !== null && (
              <line x1={cx(active)} x2={cx(active)} y1={PAD.top} y2={PAD.top + plotH} stroke={BASELINE} strokeWidth={1} />
            )}
            {kind === "visitors"
              ? values.map((v, i) => bar(i, v ?? 0))
              : (
                <>
                  {segments.map((d) => (
                    <path key={d} d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {values.map((v, i) =>
                    v === null || (days.length > 14 && active !== i && i !== days.length - 1) ? null : (
                      <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={SERIES} stroke="#ffffff" strokeWidth={2} />
                    ),
                  )}
                </>
              )}
          </svg>
        )}
        {active !== null && days[active] && <Tooltip day={days[active]} x={cx(active)} width={width} />}
      </div>
    </figure>
  );
}

export function DailyCharts({ days }: { days: Day[] }) {
  if (days.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart days={days} kind="visitors" title="Visitantes por dia" />
        <Chart days={days} kind="rate" title="Taxa de conversão por dia" />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-600">Ver os números por dia</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-1 pr-4 font-medium">Dia</th>
                <th className="py-1 pr-4 font-medium">Visitantes</th>
                <th className="py-1 pr-4 font-medium">Clicaram</th>
                <th className="py-1 font-medium">Conversão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="py-1 pr-4">{shortDate(d.day)}</td>
                  <td className="py-1 pr-4">{d.visitors}</td>
                  <td className="py-1 pr-4">{d.clickers}</td>
                  <td className="py-1">{formatRate(rate(d.clickers, d.visitors))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
