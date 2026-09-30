"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Request a new one, or use the code from the email.",
  callback: "Sign-in didn't complete. Please try again.",
  unavailable: "You're signed in, but we couldn't load your account right now. Please try again in a few minutes.",
};

function friendlyAuthError(status: number | undefined, message: string) {
  if (status === 429 || /rate limit/i.test(message)) return "Too many sign-in emails were requested. Wait a few minutes and try again.";
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired. Check the latest email, or request a new one.";
  return message;
}

export function LoginForm({ next, googleEnabled, callbackError }: { next: string; googleEnabled: boolean; callbackError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"email" | "google" | "code" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault();
    const address = (sentTo ?? email).trim();
    setPending("email");
    const { error } = await createClient().auth.signInWithOtp({
      email: address,
      // Used by the email template's link: /auth/confirm?token_hash=…&next=…
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setPending(null);
    if (error) return toast.error(friendlyAuthError(error.status, error.message));
    setSentTo(address);
    setCode("");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setPending("code");
    const { error } = await createClient().auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
    if (error) {
      setPending(null);
      return toast.error(friendlyAuthError(error.status, error.message));
    }
    // Server pages decide where to go next (the 18+ step for new users).
    router.replace(next);
    router.refresh();
  }

  async function signInWithGoogle() {
    setPending("google");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setPending(null);
      toast.error(error.message);
    }
  }

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <Mail className="mb-2 size-5 text-muted-foreground" />
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a sign-in link and a code to <span className="font-medium text-foreground">{sentTo}</span>. Tap the link on any device, or enter the code here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={verifyCode} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="otp">Code from the email</Label>
              <Input
                id="otp"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="h-12 text-center font-mono text-xl tracking-[0.4em]"
              />
            </div>
            <Button type="submit" size="lg" className="h-11 w-full" disabled={code.length < 6 || pending !== null}>
              {pending === "code" && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Sign in
            </Button>
          </form>
          <div className="flex justify-between text-sm">
            <Button variant="link" className="h-auto p-0" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
            <Button variant="link" className="h-auto p-0" onClick={() => sendLink()} disabled={pending !== null}>
              Send again
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Can&apos;t find it? Check spam or promotions. Only the newest email works.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to gameclaw</CardTitle>
        <CardDescription>New here? Signing in creates your account. No password needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {callbackError && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {ERRORS[callbackError] ?? ERRORS.callback}
          </p>
        )}
        {googleEnabled && (
          <>
            <Button variant="outline" size="lg" className="h-11 w-full" onClick={signInWithGoogle} disabled={pending !== null}>
              {pending === "google" && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" /> or <Separator className="flex-1" />
            </div>
          </>
        )}
        <form onSubmit={sendLink} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>
          <Button type="submit" size="lg" className="h-11 w-full" disabled={pending !== null}>
            {pending === "email" && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Email me a sign-in link
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          gameclaw is for adults 18+. By continuing you agree to our <Link href="/terms" className="underline">Terms</Link>{" "}
          and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </CardContent>
    </Card>
  );
}
