import { CopyButton } from "@/components/copy-button";

/** Access for the client's attendants. The password is only known right after it is generated. */
export function AccessCard({ origin, name, slug, password }: { origin: string; name: string; slug: string; password: string }) {
  const link = `${origin}/w/${slug}`;
  const message = `Acesso à planilha de leads (${name}):\nLink: ${link}\nSenha: ${password}`;
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-900">
        Acesso do atendente. Anote ou envie agora: a senha não é exibida de novo (dá para gerar outra depois).
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-600">Link</dt>
        <dd className="font-mono">{link}</dd>
        <dt className="text-zinc-600">Senha</dt>
        <dd className="font-mono text-base font-semibold">{password}</dd>
      </dl>
      <div>
        <CopyButton text={message} label="Copiar mensagem para o atendente" />
      </div>
    </div>
  );
}
