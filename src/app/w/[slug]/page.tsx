import { redirect } from "next/navigation";

export default async function WorkspaceHome({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  redirect(`/w/${slug}/leads`);
}
