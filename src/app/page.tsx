import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin";
import { currentSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function Home() {
  const session = await currentSession();
  if (session) redirect(`/w/${session.workspace.slug}/atender`);
  // The app on the home screen opens here; an admin goes to the painel mãe.
  if (await currentAdmin()) redirect("/admin");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Lead Hub</h1>
        <p className="mb-5 text-sm text-zinc-600">Leads da sua Landing Page, do anúncio ao atendimento.</p>
        <LoginForm />
        <a href="/admin" className="mt-4 block text-center text-xs text-zinc-500 hover:underline">
          Acesso do administrador
        </a>
      </div>
    </main>
  );
}
