import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const { login, role } = await requireAdmin();
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold">Minha conta</h1>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">E-mail</dt>
          <dd>{login}</dd>
          <dt className="text-zinc-500">Perfil</dt>
          <dd>{role === "master" ? "Master (vê todos os clientes e os gestores)" : "Gestor (vê os clientes dele)"}</dd>
        </dl>
      </Card>
      <Card title="Trocar senha">
        <PasswordForm login={login} />
      </Card>
    </div>
  );
}
