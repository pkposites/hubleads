import { appOrigin, requireAdmin } from "@/lib/admin";
import { CreateClientForm } from "./create-client-form";

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Novo cliente</h1>
        <p className="text-sm text-zinc-600">
          Cria a planilha do cliente, a primeira Landing Page (com o código de instalação) e a senha do atendente.
        </p>
      </div>
      <CreateClientForm origin={await appOrigin()} />
    </div>
  );
}
