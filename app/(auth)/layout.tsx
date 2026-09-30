import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
      <Link href="/" aria-label="gameclaw home">
        <Logo className="text-xl" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
