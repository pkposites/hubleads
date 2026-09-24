import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin";
import { AdminLoginForm } from "./login-form";

export default async function AdminLoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Lead Hub · Painel mãe</h1>
        <p className="mb-5 text-sm text-zinc-600">Acesso do administrador.</p>
        <AdminLoginForm />
      </div>
    </main>
  );
}
