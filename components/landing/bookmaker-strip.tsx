import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A moving strip of the bookmakers we are connected to, with their own marks.
 *
 * Each file in public/bookmakers was taken from that bookmaker's own site on 2026-10-04 and is
 * served from here rather than hotlinked, so their bandwidth is not spent on our page and the strip
 * does not break when they move a file:
 *
 *   sportybet.png     s.sporty.net/global/main/logo/144x144.png
 *   msport.png        www.msport.com/static/logo/web-192.png     (from their web manifest)
 *   footballcom.png   s.football.com/global/main/logo/144x144.png
 *
 * These say which bookmakers a code can be moved between. Nothing here claims a partnership, and
 * the brand colour behind each mark is that bookmaker's own, read from their site the same way.
 * A bookmaker with no file falls back to a coloured dot, so a newly connected one still shows.
 */
const BRAND: Record<string, { tint: string; logo?: string }> = {
  sportybet: { tint: "#E41827", logo: "/bookmakers/sportybet.png" },
  msport: { tint: "#FFCA27", logo: "/bookmakers/msport.png" },
  footballcom: { tint: "#282450", logo: "/bookmakers/footballcom.png" },
};

export function BookmakerStrip({ bookmakers, className }: { bookmakers: { slug: string; name: string }[]; className?: string }) {
  if (!bookmakers.length) return null;

  // Three bookmakers do not fill a screen, so the list is repeated until it does and then again for
  // the loop. The animation translates by exactly half the track, so the seam never shows.
  const perPass = Math.max(bookmakers.length, 6);
  const pass = Array.from({ length: perPass }, (_, i) => bookmakers[i % bookmakers.length]);

  return (
    <div className={cn("gc-marquee relative overflow-hidden", className)} aria-label={`Connected: ${bookmakers.map((b) => b.name).join(", ")}`}>
      <ul className="gc-marquee-track flex w-max items-center gap-3" aria-hidden>
        {[...pass, ...pass].map((b, i) => {
          const brand = BRAND[b.slug];
          return (
            <li
              key={`${b.slug}-${i}`}
              className="flex shrink-0 items-center gap-3 rounded-xl bg-background px-5 py-3.5 text-base font-medium tracking-tight text-foreground shadow-sm"
            >
              {brand?.logo ? (
                <span
                  className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: `color-mix(in oklab, ${brand.tint} 14%, transparent)` }}
                >
                  <Image src={brand.logo} alt="" width={28} height={28} className="size-7 object-contain" />
                </span>
              ) : (
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: brand?.tint ?? "currentColor" }} />
              )}
              {b.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
