"use client";

import { useEffect, type ReactNode } from "react";

/** Dialog that slides up from the bottom on phones and is centered on larger screens. */
export function BottomSheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-xl bg-white shadow-xl sm:rounded-lg">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="-mr-2 px-2 py-1 text-xl leading-none text-zinc-500" aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
