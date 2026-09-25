import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Esqueci minha senha</h1>
        <p className="mb-5 text-sm text-zinc-600">Informe o e-mail que você usa para entrar no painel. Enviaremos um link para criar uma senha nova.</p>
        <ForgotForm />
        <Link href="/admin/entrar" className="mt-4 block text-sm text-zinc-600 hover:underline">
          ← Voltar para o login
        </Link>
      </div>
    </main>
  );
}
