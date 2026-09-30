"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, callbackError }: { next: string; callbackError?: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setPending("email");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    });
    setPending(null);
    if (error) {
      toast.error(error.status === 429 ? "Too many attempts. Wait a minute and try again." : error.message);
      return;
    }
    setSentTo(email.trim());
  }

  async function signInWithGoogle() {
    setPending("google");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
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
          <Mail className="mb-2 size-6 text-primary" />
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a sign-in link to <span className="font-medium text-foreground">{sentTo}</span>. Open it on this
            device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to gameclaw</CardTitle>
        <CardDescription>New here? Signing in creates your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {callbackError && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {callbackError === "unavailable"
              ? "You're signed in, but we couldn't load your account right now. Please try again in a few minutes."
              : "That sign-in link is invalid or has expired. Please request a new one."}
          </p>
        )}
        <Button variant="outline" size="lg" className="w-full" onClick={signInWithGoogle} disabled={pending !== null}>
          {pending === "google" && <Loader2 className="animate-spin" data-icon="inline-start" />}
          Continue with Google
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" /> or <Separator className="flex-1" />
        </div>
        <form onSubmit={sendMagicLink} className="space-y-3">
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
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending !== null}>
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
