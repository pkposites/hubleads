import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Lead Hub</h1>
        <p className="mb-5 text-sm text-zinc-600">Leads e mensuração do anúncio até a venda.</p>
        {error && (
          <p className="mb-4 text-sm text-red-700" role="alert">
            Não foi possível confirmar o acesso. Tente novamente.
          </p>
        )}
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
