"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pulls new rows every few seconds, but never while someone is typing. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      const active = document.activeElement;
      const editing = active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
      if (!editing && document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
