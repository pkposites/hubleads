import { Card } from "@/components/ui";
import { appOrigin, requireMaster, type AdminUser } from "@/lib/admin";
import { call } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CreateGestorForm, GestorActions } from "./gestor-forms";

export default async function GestoresPage() {
  const { token } = await requireMaster();
  const [admins, origin] = await Promise.all([call<AdminUser[]>("lh_admin_list_admins", { p_token: token }), appOrigin()]);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Gestores</h1>
        <p className="text-sm text-zinc-600">
          Cada gestor entra em <code>{origin}/admin</code> com o próprio e-mail e senha e vê <strong>só os clientes dele</strong>: os que
          ele criar e os que você passar para ele. Você (master) vê todos.
        </p>
      </div>

      <Card title="Novo gestor">
        <CreateGestorForm origin={origin} />
      </Card>

      <Card title="Acessos">
        <ul className="divide-y divide-zinc-100">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{a.login}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${a.role === "master" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
                    {a.role === "master" ? "master" : "gestor"}
                  </span>
                  {!a.active && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800">desativado</span>}
                </div>
                <div className="text-xs text-zinc-500">
                  {a.role === "master" ? "Vê todos os clientes" : `${a.clients} ${a.clients === 1 ? "cliente" : "clientes"}`} · último acesso:{" "}
                  {a.last_login_at ? formatDateTime(a.last_login_at) : "nunca"}
                </div>
              </div>
              {a.role === "gestor" && <GestorActions id={a.id} login={a.login} active={a.active} origin={origin} />}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
