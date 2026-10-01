"use client";

import { useEffect, useState } from "react";
import { Check, Share, MoreVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "Add to home screen", showing only the steps for the visitor's own device.
// Android Chrome can do it in one tap via the install prompt; iOS Safari has no such API, so it
// gets the real Share -> Add to Home Screen steps instead.

type Platform = "ios" | "android" | "installed" | "desktop";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const STEPS: Record<"ios" | "android", { icon: typeof Share; text: string }[]> = {
  ios: [
    { icon: Share, text: "Tap Share in Safari" },
    { icon: Plus, text: "Choose Add to Home Screen" },
    { icon: Check, text: "Tap Add" },
  ],
  android: [
    { icon: MoreVertical, text: "Tap the menu in Chrome" },
    { icon: Plus, text: "Choose Install app" },
    { icon: Check, text: "Tap Install" },
  ],
};

export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Detect off the synchronous path so the effect never triggers a cascading render.
    const detect = () => {
      const ua = navigator.userAgent;
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      setPlatform(standalone ? "installed" : /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop");
    };
    const timer = window.setTimeout(detect, 0);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setDone(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (platform === null || platform === "installed" || done) return null;

  // Android Chrome: one tap, no instructions needed.
  if (prompt) {
    return (
      <div className="rounded-lg border bg-card p-4 text-center">
        <p className="text-sm font-medium">Add gameclaw to your home screen</p>
        <p className="mt-1 text-sm text-muted-foreground">Opens full screen, like an app.</p>
        <Button
          className="mt-3"
          onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") setDone(true);
            setPrompt(null);
          }}
        >
          Install app
        </Button>
      </div>
    );
  }

  const steps = platform === "desktop" ? null : STEPS[platform];
  if (!steps) return null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm font-medium">Add to your home screen</p>
      <p className="mt-1 text-sm text-muted-foreground">Opens full screen, like an app. Three taps:</p>
      <ol className="mt-3 space-y-2">
        {steps.map(({ icon: Icon, text }, i) => (
          <li key={text} className="flex items-center gap-3 text-sm">
            <span
              className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border bg-background")}
              style={{ animation: `gc-step 6s ease-out ${i * 0.4}s infinite` }}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="text-muted-foreground">
              <span className="mr-1.5 font-medium text-foreground">{i + 1}.</span>
              {text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
