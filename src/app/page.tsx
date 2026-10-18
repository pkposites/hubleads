import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin";
import { currentSession } from "@/lib/session";
import { FlowDemo } from "./flow-demo";
import { LandingVideo, Reveal } from "./landing-motion";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

// Presentation for visitors; the installed app (standalone) shows only the login.
const page = "[@media(display-mode:standalone)]:hidden";

const AUDIENCE = [
  {
    title: "Agências e gestores de tráfego",
    text: "Veem todos os clientes num painel só e sabem na hora quando um deles parou de receber lead.",
  },
  {
    title: "Negócios que vendem pelo WhatsApp",
    text: "Clínicas, serviços, eventos, imóveis: quem anuncia e fecha a venda na conversa.",
  },
  {
    title: "Equipes de atendimento",
    text: "Recebem o aviso no celular, atendem primeiro e marcam o que aconteceu com cada contato.",
  },
];

const STEPS = [
  { n: "1", title: "Cada clique vira uma linha", text: "A pessoa clica no anúncio, chega na página e chama no WhatsApp: o contato entra na planilha com campanha, conjunto e anúncio de origem." },
  { n: "2", title: "Aviso na hora", text: "O celular da equipe apita a cada lead novo, mesmo com o app fechado. Quem responde primeiro, vende primeiro." },
  { n: "3", title: "A equipe atende e marca", text: "Novo, em atendimento, agendado, venda (com o valor) e uma cor de qualidade: bom, médio ou ruim." },
  { n: "4", title: "As vendas voltam para os anúncios", text: "Agendamentos e vendas vão para a Meta e o Google Ads. Os anúncios aprendem quem compra e trazem mais gente parecida." },
];

const NEEDS = [
  {
    title: "Anúncios que levam a uma página com botão de WhatsApp",
    text: "Ou formulário instantâneo da Meta, ou uma planilha do Google. É por onde o lead entra.",
  },
  {
    title: "Acesso para colar um código na página",
    text: "Você, quem fez o site ou o Claude Code da página. Mandamos o passo a passo pronto.",
  },
  {
    title: "Pixel da Meta e Google Ads com acesso de administrador",
    text: "Para devolver agendamentos e vendas aos anúncios. No Google, a codificação automática ligada (já vem assim).",
  },
  {
    title: "Alguém da equipe marcando Agendado e Venda",
    text: "Leva segundos por lead, e é isso que ensina os anúncios a trazer quem compra.",
  },
  {
    title: "Um celular para receber os avisos",
    text: "O Cadê o Lead instala na tela inicial como um app e avisa a cada lead novo.",
  },
  {
    title: "Política de privacidade (LGPD)",
    text: "Não precisa ter: o Cadê o Lead gera uma para cada cliente, com o aviso de cookies na página.",
  },
];

const WORKS = [
  { title: "Landing page com botão de WhatsApp", text: "Anúncios da Meta, do Google ou tráfego orgânico. Um código colado na página e pronto." },
  { title: "Formulário instantâneo da Meta", text: "O cadastro feito dentro do Facebook ou Instagram chega sozinho, a cada minuto." },
  { title: "Planilhas do Google", text: "Leads de outros formulários ou ferramentas que já caem numa planilha." },
  { title: "Cadastro à mão", text: "Indicação, ligação ou balcão: a equipe adiciona o contato no painel." },
];

const NOT_YET = [
  {
    title: "Campanha de mensagem com clique direto para o WhatsApp",
    text: "Quando o anúncio abre o WhatsApp sem passar por uma página, o contato não é capturado sozinho. A equipe pode cadastrar à mão.",
  },
  { title: "Direct do Instagram e Messenger", text: "Conversas iniciadas por mensagem ainda não entram automaticamente." },
];

export default async function Home() {
  const session = await currentSession();
  if (session) redirect(`/w/${session.workspace.slug}/atender`);
  // The app on the home screen opens here; an admin goes to the painel mãe.
  if (await currentAdmin()) redirect("/admin");

  return (
    <div className="flex flex-1 flex-col bg-[#0d100f] text-zinc-100">
      <header className={`sticky top-0 z-20 border-b border-white/5 bg-[#0d100f]/80 backdrop-blur ${page}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="#topo" className="text-lg font-bold tracking-tight">
            CL<span className="text-emerald-400">.</span> <span className="font-medium text-zinc-300">Cadê o Lead</span>
          </a>
          <div className="flex items-center gap-2">
            <a href="#entrar" className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:text-white">
              Entrar
            </a>
            <a href="#cadastro" className="rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-zinc-900 transition hover:bg-emerald-300">
              Quero usar
            </a>
          </div>
        </div>
      </header>

      <main id="topo" className="flex-1">
        <section className={`relative overflow-hidden ${page}`}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.18),transparent_55%),radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:auto,22px_22px]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-x-12 gap-y-8 px-4 py-12 md:grid-cols-[1.1fr_1fr] md:py-20">
            <Reveal className="md:self-end">
              <p className="mb-4 inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Anúncio na Meta, no Google, WhatsApp, planilha… e aí, cadê o lead?
              </p>
              <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
                Do anúncio à venda, você sabe <span className="text-emerald-400">onde está cada lead.</span>
              </h1>
            </Reveal>
            <Reveal delay={150} className="flex justify-center md:col-start-2 md:row-span-2 md:row-start-1">
              <FlowDemo />
            </Reveal>
            <Reveal delay={250} className="md:self-start">
              <p className="max-w-xl text-lg text-zinc-300">
                O Cadê o Lead junta numa planilha só os contatos que chegam dos seus anúncios, avisa no celular na hora e devolve as
                vendas para a Meta e o Google, para as campanhas trazerem mais gente que compra.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#cadastro" className="rounded-full bg-emerald-400 px-5 py-2.5 font-semibold text-zinc-900 transition hover:bg-emerald-300">
                  Quero usar
                </a>
                <a href="#precisa" className="rounded-full border border-white/20 px-5 py-2.5 font-semibold transition hover:bg-white/10">
                  O que preciso ter?
                </a>
              </div>
            </Reveal>
          </div>
        </section>

        <section className={`mx-auto max-w-6xl px-4 py-14 ${page}`}>
          <Reveal>
            <h2 className="text-2xl font-bold sm:text-3xl">Para quem é</h2>
          </Reveal>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {AUDIENCE.map((a, i) => (
              <Reveal key={a.title} delay={i * 100}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="mt-2 text-sm text-zinc-400">{a.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="precisa" className={`scroll-mt-16 mx-auto max-w-6xl px-4 py-14 ${page}`}>
          <Reveal>
            <h2 className="text-2xl font-bold sm:text-3xl">O que você precisa ter para funcionar bem</h2>
            <p className="mt-2 max-w-2xl text-zinc-400">Nada de sistema novo para a equipe aprender: é colar um código e atender pelo celular.</p>
          </Reveal>
          <ul className="mt-8 grid gap-3 md:grid-cols-2">
            {NEEDS.map((n, i) => (
              <Reveal key={n.title} delay={i * 80}>
                <li className="flex h-full gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-400 text-sm font-bold text-zinc-900" aria-hidden>
                    ✓
                  </span>
                  <div>
                    <p className="font-medium">{n.title}</p>
                    <p className="mt-1 text-sm text-zinc-400">{n.text}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
        </section>

        <section id="como-funciona" className={`scroll-mt-16 border-y border-white/5 bg-white/[0.02] ${page}`}>
          <div className="mx-auto max-w-6xl px-4 py-14">
            <Reveal>
              <h2 className="text-2xl font-bold sm:text-3xl">Como funciona</h2>
            </Reveal>
            <ol className="mt-8 grid gap-4 md:grid-cols-4">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 120}>
                  <li className="relative h-full rounded-2xl border border-white/10 bg-[#121614] p-5">
                    <span className="grid size-9 place-items-center rounded-full bg-emerald-400 font-bold text-zinc-900">{s.n}</span>
                    <h3 className="mt-4 font-semibold">{s.title}</h3>
                    <p className="mt-2 text-sm text-zinc-400">{s.text}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className={`mx-auto max-w-6xl px-4 py-14 ${page}`}>
          <Reveal>
            <h2 className="text-2xl font-bold sm:text-3xl">Onde funciona hoje</h2>
            <p className="mt-2 max-w-2xl text-zinc-400">Para não ter surpresa: o que entra sozinho e o que ainda não.</p>
          </Reveal>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5">
                <h3 className="flex items-center gap-2 font-semibold text-emerald-300">
                  <span aria-hidden>✓</span> Funciona
                </h3>
                <ul className="mt-4 flex flex-col gap-4">
                  {WORKS.map((w) => (
                    <li key={w.title}>
                      <p className="font-medium">{w.title}</p>
                      <p className="text-sm text-zinc-400">{w.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="h-full rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-5">
                <h3 className="flex items-center gap-2 font-semibold text-amber-300">
                  <span aria-hidden>!</span> Ainda não funciona
                </h3>
                <ul className="mt-4 flex flex-col gap-4">
                  {NOT_YET.map((w) => (
                    <li key={w.title}>
                      <p className="font-medium">{w.title}</p>
                      <p className="text-sm text-zinc-400">{w.text}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 rounded-xl bg-black/30 p-3 text-sm text-zinc-300">
                  Anuncia direto para o WhatsApp? Use uma página simples com o botão do WhatsApp no meio do caminho: assim cada contato
                  entra com a origem e as vendas voltam para os anúncios.
                </p>
              </div>
            </Reveal>
          </div>
          <Reveal>
            <p className="mt-8 text-sm text-zinc-500">
              Dados tratados conforme a LGPD: aviso de cookies na página, política de privacidade por cliente e nada de senha ou token
              exposto.
            </p>
          </Reveal>
        </section>

        <section className={`border-y border-white/5 bg-white/[0.02] ${page}`}>
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-2">
            <Reveal>
              <h2 className="text-2xl font-bold sm:text-3xl">Assista em 30 segundos</h2>
              <p className="mt-2 text-zinc-400">Do anúncio à venda, com o painel que a agência e a equipe usam todo dia.</p>
            </Reveal>
            <Reveal delay={120}>
              <LandingVideo />
            </Reveal>
          </div>
        </section>

        <section id="cadastro" className={`scroll-mt-16 mx-auto max-w-3xl px-4 py-16 ${page}`}>
          <Reveal>
            <h2 className="text-center text-3xl font-bold">Quero usar o Cadê o Lead</h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-zinc-400">
              Conte como seus leads chegam hoje. A gente chama no WhatsApp, confere se funciona para o seu caso e deixa tudo instalado.
            </p>
          </Reveal>
          <Reveal delay={100} className="mt-8 rounded-3xl border border-white/10 bg-[#121614] p-5 sm:p-8">
            <SignupForm />
          </Reveal>
        </section>

        <section
          id="entrar"
          className="scroll-mt-16 px-4 py-14 [@media(display-mode:standalone)]:flex [@media(display-mode:standalone)]:min-h-dvh [@media(display-mode:standalone)]:items-center [@media(display-mode:standalone)]:justify-center"
        >
          <div className="mx-auto w-full max-w-sm rounded-2xl bg-white p-6 text-zinc-900 shadow-2xl shadow-emerald-950/40">
            <p className="text-lg font-bold tracking-tight">
              CL<span className="text-emerald-500">.</span> Cadê o Lead
            </p>
            <p className="mb-5 text-sm text-zinc-600">Já é cliente? Entre com o endereço da sua empresa e a senha que você recebeu.</p>
            <LoginForm />
            <a href="/admin" className="mt-4 block text-center text-xs text-zinc-500 hover:underline">
              Acesso do administrador (painel da agência)
            </a>
          </div>
        </section>
      </main>

      <footer className={`border-t border-white/5 py-6 text-center text-xs text-zinc-500 ${page}`}>
        cadeolead.com.br · Do anúncio à venda, você sabe onde está cada lead.
      </footer>
    </div>
  );
}
