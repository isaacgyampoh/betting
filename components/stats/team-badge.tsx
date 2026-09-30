import Image from "next/image";
import { cn } from "@/lib/utils";
import type { TeamRef } from "@/lib/stats/types";

export function TeamBadge({ team, size = 32, className }: { team: TeamRef; size?: number; className?: string }) {
  if (team.logo) {
    return <Image src={team.logo} alt="" width={size} height={size} className={cn("shrink-0 object-contain", className)} />;
  }
  const initials = team.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground", className)}
    >
      {initials}
    </span>
  );
}
