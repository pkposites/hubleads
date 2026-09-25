import Link from "next/link";
import { call } from "@/lib/db";
import { serverSecret } from "@/lib/server";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/admin/redefinir">) {
  const token = (await searchParams).t;
  const secret = serverSecret();
  const valid =
    typeof token === "string" &&
    /^[0-9a-f]{64}$/.test(token) &&
    secret !== null &&
    (await call<boolean>("lh_server_admin_reset_valid", { p_secret: secret, p_token: token }));

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Criar senha nova</h1>
        {valid ? (
          <>
            <p className="mb-5 text-sm text-zinc-600">Escolha uma senha com pelo menos 10 caracteres. Depois, entre com ela no painel.</p>
            <ResetForm token={token} />
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-700">Este link expirou ou já foi usado. Os links valem por 30 minutos e só o último pedido funciona.</p>
            <Link href="/admin/esqueci" className="mt-4 inline-block text-sm font-medium hover:underline">
              Pedir um link novo
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
