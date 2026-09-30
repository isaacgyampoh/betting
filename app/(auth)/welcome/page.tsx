import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth";
import { safeNext } from "@/lib/auth-pages";
import { AgeConfirmForm } from "./age-confirm-form";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const nextPath = safeNext((await searchParams).next);
  const user = await getAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const profile = await getProfile(user);
  if (profile.ageConfirmedAt) redirect(nextPath);
  return <AgeConfirmForm next={nextPath} />;
}
