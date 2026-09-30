import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { safeNext } from "@/lib/auth-pages";
import { enabledProviders } from "@/lib/auth-providers";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = safeNext(next);
  if (await getAuthUser()) redirect(nextPath);
  const providers = await enabledProviders();
  return <LoginForm next={nextPath} googleEnabled={providers.google} callbackError={typeof error === "string" ? error : undefined} />;
}
