import { requireAdultPage } from "@/lib/auth-pages";

// Auth guard outside this section's loading.tsx, so signed-out visitors get a real redirect.
export default async function GuardLayout({ children }: { children: React.ReactNode }) {
  await requireAdultPage("/chat");
  return children;
}
