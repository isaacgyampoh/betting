import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="size-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-muted-foreground">Check your connection and try again. Odds and slips need a live connection.</p>
    </main>
  );
}
