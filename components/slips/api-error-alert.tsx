"use client";

import { AlertCircle, CalendarX, CreditCard, RotateCw, Timer, WifiOff } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api-client";

const ERROR_UI: Record<string, { title: string; icon: typeof AlertCircle; retry?: boolean; destructive?: boolean }> = {
  INVALID_CODE: { title: "Code not found", icon: AlertCircle, destructive: true },
  EXPIRED_CODE: { title: "Code expired", icon: CalendarX, destructive: true },
  BOOKMAKER_UNAVAILABLE: { title: "Bookmaker unavailable", icon: WifiOff, retry: true },
  RATE_LIMITED: { title: "Slow down", icon: Timer },
  PLAN_LIMIT_REACHED: { title: "Limit reached", icon: CreditCard },
  NETWORK: { title: "You're offline", icon: WifiOff, retry: true },
  BAD_REQUEST: { title: "Can't do that", icon: AlertCircle },
};

export function ApiErrorAlert({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const ui = ERROR_UI[error.code] ?? { title: "Something went wrong", icon: AlertCircle, retry: true };
  const Icon = ui.icon;
  return (
    <Alert variant={ui.destructive ? "destructive" : "default"} role="alert">
      <Icon />
      <AlertTitle>{ui.title}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {ui.retry && onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RotateCw data-icon="inline-start" /> Try again
          </Button>
        )}
        {error.code === "PLAN_LIMIT_REACHED" && (
          <Button asChild size="sm" className="mt-2">
            <Link href="/pricing">See plans</Link>
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
