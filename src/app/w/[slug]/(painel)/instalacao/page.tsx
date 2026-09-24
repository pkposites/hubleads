import { headers } from "next/headers";
import { Card } from "@/components/ui";
import { call } from "@/lib/db";
import type { Page } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { PageSettings } from "./page-settings";

export default async function InstallPage({ params }: PageProps<"/w/[slug]/instalacao">) {
  const { slug } = await params;
  const { token } = await requireWorkspace(slug);
  const pages = await call<Page[]>("lh_list_pages", { p_token: token });

  const h = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Instalação na Landing Page</h1>
        <p className="text-sm text-zinc-600">
          Cole o código abaixo uma única vez na LP, junto com o pixel da Meta (no <code>&lt;head&gt;</code> ou antes do{" "}
          <code>&lt;/body&gt;</code>). Nenhuma outra mudança é necessária.
        </p>
      </div>

      {pages.map((page) => (
        <div key={page.id} className="flex flex-col gap-4">
          <Card title={`Código para ${page.name}`}>
            <pre className="overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
{`<script src="${origin}/tracker.js" data-key="${page.public_key}" async></script>`}
            </pre>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
              <li>Guarda as UTMs, gclid, fbclid e os cookies do pixel da Meta (_fbp e _fbc) de cada visita.</li>
              <li>
                Todo clique em link de WhatsApp (<code>wa.me</code>, <code>api.whatsapp.com</code>) vira uma linha na
                planilha, sem atrasar a abertura do WhatsApp.
              </li>
              <li>Se a LP tiver um campo de nome preenchido, o nome já entra na linha.</li>
              <li>
                Se o botão abre o WhatsApp pelo próprio script da LP, use{" "}
                <code>window.open(LeadHub.whatsappUrl(url))</code> no lugar de <code>window.open(url)</code>.
              </li>
            </ul>
          </Card>

          <Card title="Como testar">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
              <li>
                Abra a LP com UTMs de teste, por exemplo <code>?utm_source=teste&amp;utm_campaign=instalacao</code>.
              </li>
              <li>Veja a visita chegar em Eventos.</li>
              <li>Clique no botão de WhatsApp. A mensagem deve terminar com &quot;(cód. XXXX)&quot;.</li>
              <li>Na Planilha, a linha aparece com o mesmo código, pronta para o atendente preencher o telefone.</li>
            </ol>
          </Card>

          <Card title="Configurações">
            <PageSettings slug={slug} page={page} />
          </Card>
        </div>
      ))}
    </div>
  );
}
