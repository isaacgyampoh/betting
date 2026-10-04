import Image from "next/image";
import { cn } from "@/lib/utils";
import type { TeamRef } from "@/lib/stats/types";

/**
 * A team or league crest, or its initials when there is no logo to show.
 *
 * `logo={false}` forces the initials. That is not a fallback, it is the right choice in a long
 * list: the provider serves these at full resolution - one league crest is 265 KB - and there is
 * nowhere to resize them, because image transformations need a paid Cloudflare plan. A day's
 * fixtures were pulling 6 MB of crests to draw them 20 pixels wide, on phones paying for the data
 * by the megabyte. Three real crests on a match page are worth it; three hundred in a list are not.
 */
export function TeamBadge({
  team,
  size = 32,
  className,
  logo = true,
}: {
  team: TeamRef;
  size?: number;
  className?: string;
  logo?: boolean;
}) {
  if (logo && team.logo) {
    return <Image src={team.logo} alt="" width={size} height={size} loading="lazy" className={cn("shrink-0 object-contain", className)} />;
  }
  const initials = team.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground", className)}
    >
      {initials}
    </span>
  );
}
