import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo className="text-xl" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">That link doesn&apos;t go anywhere.</p>
      <Button asChild size="lg">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
