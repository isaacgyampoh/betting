import { requireAdultPage } from "@/lib/auth-pages";

// Auth guard outside this section's loading.tsx, so signed-out visitors get a real redirect.
export default async function GuardLayout({ children, params }: LayoutProps<"/matches/[id]">) {
  await requireAdultPage(`/matches/${encodeURIComponent((await params).id)}`);
  return children;
}
