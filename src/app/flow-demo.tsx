"use client";

import { useEffect, useState, type ReactNode } from "react";

const STEPS = [
  { label: "Anúncio", text: "A pessoa vê seu anúncio na Meta ou no Google e clica." },
  { label: "Página", text: "Chega na sua página e toca em “Chamar no WhatsApp”." },
  { label: "Planilha", text: "O contato vira uma linha, já com campanha e anúncio de origem." },
  { label: "Aviso", text: "Seu celular apita na hora: lead novo." },
  { label: "Atendimento", text: "A equipe atende e marca: agendou, vendeu e quanto." },
  { label: "Retorno", text: "A venda volta para a Meta e o Google. Os anúncios aprendem quem compra." },
];
const DURATION = 3200;

/** Animated walk-through of a lead, from the ad to the sale, that plays on its own. */
export function FlowDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), DURATION);
    return () => clearTimeout(t);
  }, [step, paused]);

  return (
    <div className="w-full max-w-md" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-[#121614] shadow-2xl shadow-emerald-950/40">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:18px_18px]" />
        <Scene on={step === 0}>
          <AdCard />
        </Scene>
        <Scene on={step === 1}>
          <LandingCard />
        </Scene>
        <Scene on={step === 2}>
          <SheetCard />
        </Scene>
        <Scene on={step === 3}>
          <PhoneCard />
        </Scene>
        <Scene on={step === 4}>
          <StatusCard active={step === 4} />
        </Scene>
        <Scene on={step === 5}>
          <ReturnCard active={step === 5} />
        </Scene>
      </div>
      <p className="mt-4 min-h-12 text-center text-sm text-zinc-300" aria-live="polite">
        <span className="font-semibold text-emerald-400">{step + 1}. </span>
        {STEPS[step].text}
      </p>
      <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            role="tab"
            aria-selected={i === step}
            onClick={() => setStep(i)}
            className={`h-1.5 rounded-full transition-all ${i === step ? "w-8 bg-emerald-400" : "w-3 bg-white/20 hover:bg-white/40"}`}
            title={s.label}
          >
            <span className="sr-only">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Scene({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!on}
      className={`absolute inset-0 grid place-items-center p-6 transition duration-500 motion-reduce:transition-none ${
        on ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
      }`}
    >
      {on && children}
    </div>
  );
}

const Cursor = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`absolute size-6 drop-shadow ${className}`} aria-hidden>
    <path d="M4 2l16 10-7 1.5L9.5 21z" fill="white" stroke="black" strokeWidth="1.2" />
  </svg>
);

function AdCard() {
  return (
    <div className="relative w-64 animate-[lh-pop_.5s_ease-out] rounded-2xl bg-white p-3 text-zinc-900 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span className="size-6 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400" />
        <div>
          <p className="font-semibold">Clínica Sorriso</p>
          <p className="text-[10px] text-zinc-500">Patrocinado</p>
        </div>
      </div>
      <div className="mt-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-400 p-4 text-white">
        <p className="text-lg font-bold leading-tight">Avaliação gratuita esta semana</p>
      </div>
      <div className="mt-2 rounded-lg bg-zinc-100 py-1.5 text-center text-xs font-semibold">Saiba mais</div>
      <Cursor className="bottom-1 right-16 animate-[lh-click_1.6s_ease-in-out_.4s_both]" />
    </div>
  );
}

function LandingCard() {
  return (
    <div className="relative w-64 animate-[lh-pop_.5s_ease-out] overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-xl">
      <div className="flex items-center gap-1 bg-zinc-100 px-3 py-1.5">
        <span className="size-2 rounded-full bg-red-400" />
        <span className="size-2 rounded-full bg-amber-400" />
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="ml-2 truncate text-[10px] text-zinc-500">clinicasorriso.com.br</span>
      </div>
      <div className="p-4">
        <div className="h-3 w-40 rounded bg-zinc-800" />
        <div className="mt-2 h-2 w-48 rounded bg-zinc-200" />
        <div className="mt-1 h-2 w-36 rounded bg-zinc-200" />
        <div className="mt-4 animate-[lh-pulse_1.2s_ease-in-out_infinite] rounded-lg bg-emerald-500 py-2 text-center text-xs font-bold text-white">
          Chamar no WhatsApp
        </div>
      </div>
      <Cursor className="bottom-3 right-20 animate-[lh-click_1.6s_ease-in-out_.4s_both]" />
    </div>
  );
}

function SheetCard() {
  const rows = [
    { code: "7F3K", name: "Marina S.", origin: "Meta · [LEAD] Avaliação", status: "Novo", isNew: true },
    { code: "K2ZC", name: "Carlos M.", origin: "Google · Implante", status: "Agendado" },
    { code: "T6NC", name: "João P.", origin: "Meta · Carrossel 01", status: "Venda" },
  ];
  return (
    <div className="w-72 rounded-2xl bg-white p-3 text-zinc-900 shadow-xl">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold">Leads · Clínica Sorriso</span>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">ao vivo</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li
            key={r.code}
            style={{ animationDelay: `${r.isNew ? 300 : 0}ms` }}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
              r.isNew ? "animate-[lh-slide_.6s_ease-out_both] border-emerald-300 bg-emerald-50" : "border-zinc-100"
            } ${i > 0 ? "opacity-70" : ""}`}
          >
            <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-white">{r.code}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.name}</p>
              <p className="truncate text-[10px] text-zinc-500">{r.origin}</p>
            </div>
            <span className="text-[10px] text-zinc-600">{r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneCard() {
  return (
    <div className="relative h-56 w-36 rounded-[1.6rem] border-4 border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-950 p-2 shadow-xl">
      <p className="mt-6 text-center text-[10px] text-zinc-400">sábado, 18 de outubro</p>
      <p className="text-center text-2xl font-semibold text-white">14:32</p>
      <div className="mt-3 animate-[lh-drop_.6s_ease-out_.3s_both] rounded-xl bg-white/90 p-2 text-zinc-900 shadow-lg">
        <p className="text-[9px] text-zinc-500">CL. Cadê o Lead · agora</p>
        <p className="text-[11px] font-bold">Novo lead: Marina S.</p>
        <p className="text-[9px] text-zinc-600">Meta · [LEAD] Avaliação</p>
      </div>
    </div>
  );
}

function StatusCard({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) return;
    const a = setTimeout(() => setPhase(1), 900);
    const b = setTimeout(() => setPhase(2), 1900);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [active]);
  const statuses = ["Novo", "Agendado", "Venda"];
  return (
    <div className="w-72 rounded-2xl bg-white p-4 text-zinc-900 shadow-xl">
      <p className="text-lg font-bold">Marina S.</p>
      <p className="text-[11px] text-zinc-500">Meta · [LEAD] Avaliação · Depoimento 02</p>
      <div className="mt-3 flex gap-1.5">
        {statuses.map((s, i) => (
          <span
            key={s}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              i === phase
                ? i === 2
                  ? "bg-emerald-500 text-white"
                  : i === 1
                    ? "bg-amber-400 text-zinc-900"
                    : "bg-zinc-800 text-white"
                : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Valor da venda</span>
        <span className={`font-mono text-xl font-bold transition ${phase === 2 ? "text-emerald-600" : "text-zinc-300"}`}>
          {phase === 2 ? "R$ 1.850,00" : "R$ 0,00"}
        </span>
      </div>
    </div>
  );
}

function ReturnCard({ active }: { active: boolean }) {
  const [grow, setGrow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setGrow(true), 700);
    return () => clearTimeout(t);
  }, [active]);
  const bars = [28, 34, 40, 52, 66, 88];
  return (
    <div className="flex w-80 flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="grid size-14 place-items-center rounded-full bg-white text-lg font-black text-zinc-900">
          <span>
            CL<span className="text-emerald-500">.</span>
          </span>
        </span>
        <div className="flex flex-col gap-2">
          {["Meta Ads", "Google Ads"].map((n, i) => (
            <div key={n} className="relative flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white">
              <span className="font-semibold">{n}</span>
              <span
                style={{ animationDelay: `${i * 250}ms` }}
                className="absolute -left-24 top-1 animate-[lh-fly_1.2s_ease-out_both] rounded bg-emerald-400 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-900"
              >
                Venda · R$ 1.850
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl bg-white p-3 text-zinc-900">
        <p className="text-xs font-semibold">Vendas vindas dos anúncios</p>
        <div className="mt-2 flex h-20 items-end gap-1.5">
          {bars.map((h, i) => (
            <div
              key={i}
              style={{ height: grow ? `${h}%` : "8%", transitionDelay: `${i * 90}ms` }}
              className={`flex-1 rounded-t transition-all duration-700 ${i === bars.length - 1 ? "bg-emerald-500" : "bg-emerald-200"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
