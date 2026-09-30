"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-sm space-y-4 py-12 text-center">
      <AlertTriangle className="mx-auto size-10 text-destructive" />
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        It&apos;s on our side, not yours. Please try again.{error.digest && <span className="block pt-1 font-mono text-xs">Ref: {error.digest}</span>}
      </p>
      <Button onClick={reset} size="lg" className="h-11">
        <RotateCw data-icon="inline-start" /> Try again
      </Button>
    </div>
  );
}
