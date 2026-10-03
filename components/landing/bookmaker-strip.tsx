import { cn } from "@/lib/utils";

// A moving strip of the bookmakers we are connected to.
//
// Their logo files are theirs, so this does not use them. Each one gets its own brand colour as a
// mark beside its name, which identifies it without copying anything. Every colour below was read
// from that bookmaker's own site on 2026-10-02, with where it came from recorded, so none of it is
// a guess:
//
//   SportyBet     #E41827  <meta name="theme-color"> on sportybet.com/gh
//   MSport        #FFCA27  the accent in their stylesheet (index.*.css, by far its commonest colour)
//   Football.com  #282450  <meta name="theme-color"> on football.com/gh
//
// A new bookmaker without an entry still shows, with a neutral mark.
const BRAND: Record<string, string> = {
  sportybet: "#E41827",
  msport: "#FFCA27",
  footballcom: "#282450",
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
        {[...pass, ...pass].map((b, i) => (
          <li
            key={`${b.slug}-${i}`}
            className="flex shrink-0 items-center gap-2.5 rounded-lg bg-background px-5 py-3 text-base font-medium tracking-tight text-foreground"
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: BRAND[b.slug] ?? "currentColor" }} />
            {b.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
