"use client";

import { useActionState } from "react";
import { requestSignup } from "./signup-actions";

const field = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-base text-white placeholder:text-zinc-500 focus:border-emerald-400 focus:outline-none sm:text-sm";

const CHANNELS = [
  ["lp", "Landing page / site com WhatsApp"],
  ["meta_form", "Formulário instantâneo da Meta"],
  ["google", "Google Ads"],
  ["sheets", "Planilha do Google"],
  ["whatsapp_direto", "Anúncio direto para o WhatsApp"],
  ["nao_anuncia", "Ainda não anuncio"],
] as const;

/** "Quero usar" request: the master gets it in the painel mãe and calls back on WhatsApp. */
export function SignupForm() {
  const [state, action, pending] = useActionState(requestSignup, undefined);
  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-6 text-center" role="status">
        <p className="text-lg font-semibold text-emerald-300">Recebemos seu pedido!</p>
        <p className="mt-2 text-sm text-zinc-300">Vamos chamar você no WhatsApp para entender seus anúncios e liberar o acesso.</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" required placeholder="Seu nome" autoComplete="name" className={field} aria-label="Seu nome" />
        <input name="company" required placeholder="Empresa ou agência" autoComplete="organization" className={field} aria-label="Empresa ou agência" />
        <input name="whatsapp" required inputMode="tel" placeholder="WhatsApp com DDD" autoComplete="tel" className={field} aria-label="WhatsApp" />
        <input name="email" type="email" placeholder="E-mail (opcional)" autoComplete="email" className={field} aria-label="E-mail" />
      </div>
      <fieldset className="flex flex-wrap gap-2 text-sm">
        <legend className="mb-2 text-sm text-zinc-300">Você é:</legend>
        {[
          ["agencia", "Agência / gestor de tráfego"],
          ["negocio", "Dono do negócio"],
          ["outro", "Outro"],
        ].map(([value, label], i) => (
          <label key={value} className="cursor-pointer">
            <input type="radio" name="profile" value={value} defaultChecked={i === 0} className="peer sr-only" />
            <span className="inline-block rounded-full border border-white/15 px-3 py-1.5 text-zinc-300 transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400/15 peer-checked:text-emerald-200 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400">
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-2 text-sm">
        <legend className="mb-2 text-sm text-zinc-300">Seus leads chegam por (marque todos):</legend>
        {CHANNELS.map(([value, label]) => (
          <label key={value} className="cursor-pointer">
            <input type="checkbox" name="channels" value={value} className="peer sr-only" />
            <span className="inline-block rounded-full border border-white/15 px-3 py-1.5 text-zinc-300 transition peer-checked:border-emerald-400 peer-checked:bg-emerald-400/15 peer-checked:text-emerald-200 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400">
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      <textarea name="message" rows={2} maxLength={1000} placeholder="Quer contar algo? (opcional)" className={field} aria-label="Mensagem" />
      {/* Honeypot: hidden from people, bots fill it. */}
      <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {state?.error && (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-full bg-emerald-400 px-6 py-3 font-semibold text-zinc-900 transition hover:bg-emerald-300 disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Quero usar o Cadê o Lead"}
      </button>
      <p className="text-xs text-zinc-500">Usamos seus dados só para falar com você sobre o Cadê o Lead.</p>
    </form>
  );
}
