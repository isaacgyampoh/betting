import { cn } from "@/lib/utils";

/** Three claw slashes on a rounded tile. Shared by the header and the generated app icons. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-primary-foreground">
        <path d="M10 23 L14 9" />
        <path d="M15.5 24 L19.5 10" />
        <path d="M21 23 L24 13" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">gameclaw</span>
    </span>
  );
}
