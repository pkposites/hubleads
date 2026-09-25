import { call } from "@/lib/db";
import type { Template } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { TemplateEditor, TemplatePreview } from "./template-editor";

export default async function TemplatesPage({ params }: PageProps<"/w/[slug]/mensagens">) {
  const { slug } = await params;
  const { token, workspace } = await requireWorkspace(slug);
  const templates = await call<Template[]>("lh_list_templates", { p_token: token });
  const isAdmin = workspace.role === "admin";

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Mensagens prontas</h1>
        <p className="text-sm text-zinc-600">
          Aparecem ao tocar em <strong>WhatsApp</strong> num lead. Use <code>{"{nome}"}</code> para o primeiro nome do lead e{" "}
          <code>{"{empresa}"}</code> para &quot;{workspace.name}&quot;.
          {!isAdmin && " Só o administrador altera as mensagens."}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {templates.map((t) => (
          <li key={t.id}>{isAdmin ? <TemplateEditor slug={slug} template={t} /> : <TemplatePreview template={t} company={workspace.name} />}</li>
        ))}
      </ul>
      {isAdmin && <TemplateEditor slug={slug} template={null} nextPosition={(templates.at(-1)?.position ?? 0) + 1} />}
    </div>
  );
}
