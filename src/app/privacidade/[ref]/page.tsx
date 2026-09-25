import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { call } from "@/lib/db";
import type { PublicPrivacy } from "@/lib/privacy";

async function load(ref: string) {
  if (!/^[a-z0-9_-]{1,80}$/i.test(ref)) return null;
  return call<PublicPrivacy | null>("lh_public_privacy", { p_ref: ref });
}

export async function generateMetadata({ params }: PageProps<"/privacidade/[ref]">): Promise<Metadata> {
  const data = await load((await params).ref);
  return { title: data ? `Política de privacidade · ${data.controller}` : "Política de privacidade", robots: { index: false } };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-zinc-700">{children}</div>
    </section>
  );
}

/** Public privacy policy of a client, linked from its landing pages and the consent banner. */
export default async function PrivacyPage({ params }: PageProps<"/privacidade/[ref]">) {
  const data = await load((await params).ref);
  if (!data) notFound();
  const updated = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(data.updated_at));
  const contact = data.email ? (
    <>
      pelo e-mail{" "}
      <a href={`mailto:${data.email}`} className="font-medium text-zinc-900 underline">
        {data.email}
      </a>
    </>
  ) : (
    "pelos canais de atendimento da empresa"
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold">Política de privacidade</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data.controller} · atualizada em {updated}
        </p>
      </header>

      <Section title="1. Quem cuida dos seus dados">
        <p>
          <strong>{data.controller}</strong>
          {data.document && ` (${data.document})`} é a controladora dos dados pessoais tratados quando você visita nosso site e
          fala com a nossa equipe, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD). Para qualquer assunto sobre
          privacidade, fale com a gente {contact}.
        </p>
      </Section>

      <Section title="2. Quais dados coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Que você informa:</strong> nome, telefone/WhatsApp e as respostas que escolher dar no site (por exemplo, em um
            questionário).
          </li>
          <li>
            <strong>Da navegação, só se você aceitar:</strong> páginas visitadas, origem do acesso (anúncio, campanha e parâmetros do
            link), identificadores de clique e cookies de anúncios (como os da Meta), endereço IP, tipo de navegador e dispositivo, e
            ações no site, como clicar para falar pelo WhatsApp.
          </li>
          <li>
            <strong>Do atendimento:</strong> andamento da conversa, agendamentos e valores de compra registrados pela nossa equipe.
          </li>
        </ul>
        <p>Se você recusar os cookies, guardamos apenas o contato que você mesmo digitou para ser atendido.</p>
      </Section>

      <Section title="3. Para que usamos e com qual base legal">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Responder ao seu contato e prestar o atendimento</strong> que você pediu: procedimentos preliminares a um contrato,
            a seu pedido (art. 7º, V, da LGPD).
          </li>
          <li>
            <strong>Medir os resultados dos nossos anúncios e melhorar as campanhas</strong>: seu consentimento (art. 7º, I), que pode
            ser retirado a qualquer momento.
          </li>
          <li>
            <strong>Informações de saúde</strong> que você decida contar (por exemplo, num questionário): seu consentimento específico
            e destacado (art. 11, I), usadas somente para o seu atendimento e nunca enviadas a plataformas de anúncios.
          </li>
          <li>
            <strong>Cumprir obrigações legais e nos defender</strong> em processos: art. 7º, II e VI.
          </li>
        </ul>
      </Section>

      <Section title="4. Com quem compartilhamos">
        <p>Não vendemos seus dados. Eles são tratados por empresas que nos prestam serviço, apenas para as finalidades acima:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Lead Hub, sistema de gestão de contatos que organiza o atendimento (operador).</li>
          <li>Supabase, banco de dados com servidores no Brasil (São Paulo), e Netlify, hospedagem do sistema (Estados Unidos).</li>
          <li>
            Meta Platforms (Facebook e Instagram), somente com o seu consentimento: dados de navegação para medir anúncios
            {data.meta &&
              " e, quando você agenda ou compra, o registro desse resultado com telefone e nome em formato criptografado (hash)"}
            .
          </li>
        </ul>
        <p>
          Alguns desses serviços podem tratar dados fora do Brasil. Nesses casos, a transferência segue as garantias previstas no art. 33
          da LGPD.
        </p>
      </Section>

      <Section title="5. Cookies e armazenamento no navegador">
        <p>
          Ao aceitar, guardamos no seu navegador um identificador aleatório e a origem da sua visita, por até 90 dias, para saber de qual
          anúncio você veio. Ao recusar, nada disso é guardado; só registramos a sua escolha para não perguntar de novo. Para mudar de
          ideia, apague os dados deste site no seu navegador e responda de novo.
        </p>
      </Section>

      <Section title="6. Por quanto tempo guardamos">
        <p>
          Dados de contato e de atendimento: até {data.retention_months} meses depois do último contato, e depois são apagados
          automaticamente. IP e tipo de navegador: 90 dias. Podemos guardar por mais tempo apenas o que a lei exigir.
        </p>
      </Section>

      <Section title="7. Seus direitos">
        <p>Pela LGPD (art. 18), você pode pedir, a qualquer momento e sem custo:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>confirmação de que tratamos seus dados e acesso a eles;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei;</li>
          <li>portabilidade dos dados;</li>
          <li>eliminação dos dados tratados com base no seu consentimento, e informação sobre as consequências de não consentir;</li>
          <li>informação sobre com quem compartilhamos seus dados;</li>
          <li>revogação do consentimento.</li>
        </ul>
        <p>
          Para exercer seus direitos, fale com a gente {contact}. Respondemos em até 15 dias. Você também pode apresentar reclamação
          à Autoridade Nacional de Proteção de Dados (ANPD), em{" "}
          <a href="https://www.gov.br/anpd" className="underline" target="_blank" rel="noopener noreferrer">
            gov.br/anpd
          </a>
          .
        </p>
      </Section>

      <Section title="8. Segurança">
        <p>
          O acesso aos dados é restrito à nossa equipe, com senha e limite de tentativas. As conexões são criptografadas, as credenciais de
          integração são guardadas criptografadas e exportações e exclusões ficam registradas.
        </p>
      </Section>

      <Section title="9. Mudanças nesta política">
        <p>Podemos atualizar esta política. A data da última atualização fica no topo da página.</p>
      </Section>
    </main>
  );
}
