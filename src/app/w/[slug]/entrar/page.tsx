import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { LoginForm } from "../../../login-form";

export default async function EnterPage({ params }: PageProps<"/w/[slug]/entrar">) {
  const { slug } = await params;
  const session = await currentSession();
  if (session?.workspace.slug === slug) redirect(`/w/${slug}`);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Lead Hub</h1>
        <p className="mb-5 text-sm text-zinc-600">Digite a senha de acesso.</p>
        <LoginForm slug={slug} />
      </div>
    </main>
  );
}
