"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The presentation video in a phone frame: plays muted on its own, with a button for sound. */
export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted) {
      v.currentTime = 0;
      void v.play();
    }
    setMuted(v.muted);
  };
  return (
    <div className="relative mx-auto w-[260px] sm:w-[300px]">
      <div className="absolute -inset-10 -z-10 rounded-full bg-emerald-500/20 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-[2.4rem] border-[6px] border-zinc-800 bg-black shadow-2xl shadow-emerald-950/50">
        <video
          ref={video}
          className="block aspect-[9/16] w-full"
          poster="/media/cadeolead-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Vídeo: como o Cadê o Lead funciona, do anúncio à venda"
        >
          <source src="/media/cadeolead.mp4" type="video/mp4" />
          <source src="/media/cadeolead.webm" type="video/webm" />
        </video>
      </div>
      <button
        type="button"
        onClick={toggle}
        className="absolute bottom-4 right-4 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/80"
      >
        {muted ? "🔇 Ativar som" : "🔊 Som ligado"}
      </button>
    </div>
  );
}

/** Fades content in when it scrolls into view (instant for people who prefer less motion). */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setShown(true);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition duration-700 ease-out motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"} ${className}`}
    >
      {children}
    </div>
  );
}
