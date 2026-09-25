"use client";

import { useEffect, useRef } from "react";

/** Short two-note chime, generated so no audio file is needed. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
    window.setTimeout(() => ctx.close(), 1000);
  } catch {
    // Audio blocked until the page gets a tap; the title still changes.
  }
}

/**
 * While the panel is open: plays a sound and shows the count in the tab
 * title when a new lead arrives (the page refreshes every few seconds).
 */
export function NewLeadAlert({ latest, waiting }: { latest: string | null; waiting: number }) {
  const seen = useRef(latest);
  useEffect(() => {
    if (latest && seen.current && latest > seen.current) {
      chime();
      navigator.vibrate?.([120, 60, 120]);
    }
    seen.current = latest;
  }, [latest]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
  }, [waiting]);
  return null;
}
