import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin";
import { AdminLoginForm } from "./login-form";

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/entrar">) {
  if (await currentAdmin()) redirect("/admin");
  const changed = (await searchParams).senha === "nova";
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Lead Hub · Painel mãe</h1>
        <p className="mb-5 text-sm text-zinc-600">Acesso do administrador.</p>
        {changed && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            Senha nova salva. Entre com ela.
          </p>
        )}
        <AdminLoginForm />
        <Link href="/admin/esqueci" className="mt-4 block text-sm text-zinc-600 hover:underline">
          Esqueci minha senha
        </Link>
      </div>
    </main>
  );
}
