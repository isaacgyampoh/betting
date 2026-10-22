import Image from "next/image";

/**
 * What the app actually looks like.
 *
 * These are screenshots taken off a real Pixel running the real build against production - not
 * mockups, not a designer's render of what it might become. The fixtures in them were live when
 * the picture was taken.
 *
 * That matters more here than it would on most sites: a betting tool asking people to paste a
 * booking code is asking for trust, and a marketing page full of invented screens is the first
 * thing that undermines it. If a screen changes enough that these stop being accurate, they should
 * be retaken rather than touched up.
 */
const SCREENS = [
  {
    src: "/screens/results.png",
    alt: "GameClaw's results list for a Champions League night, grouped by competition, showing Como 4-1 Manchester United and Bayern Munchen 2-2 Arsenal",
    title: "A whole night, in one list",
    text: "Results and live scores grouped by competition, from the leagues people actually follow.",
  },
  {
    src: "/screens/match-centre.png",
    alt: "GameClaw's match statistics for Bayern Munchen against Arsenal: possession, shots, corners, fouls, cards and passes",
    title: "The full picture on a game",
    text: "Possession, shots, corners and cards, with recent form and head-to-head a tab away.",
  },
  {
    src: "/screens/convert.png",
    alt: "GameClaw's Convert screen, listing which bookmakers it can read booking codes from and which it can issue them at",
    title: "Move a code across",
    text: "It says plainly which bookmakers it can read and which it can book at, and why the others cannot.",
  },
];

export function Screens() {
  return (
    <section aria-labelledby="screens" className="gc-reveal space-y-6">
      <div className="max-w-2xl space-y-3">
        <h2 id="screens" className="text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
          This is the actual app
        </h2>
        <p className="text-balance text-muted-foreground">
          Screenshots from a real phone, running against the same live data you would get.
        </p>
      </div>

      {/* Three phone screenshots stacked at full width cost three whole screens of scrolling on a
          Pixel, each one a bright block on a dark page. As a snapping row they cost one, and the
          78% card width leaves the next one peeking so it reads as swipeable without a caption
          saying so. From `sm` up there is room for all three at once and it is a grid again. */}
      <div
        data-scroll-contain
        className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:scroll-pl-0 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {SCREENS.map((screen) => (
          <figure key={screen.src} className="w-[78%] shrink-0 snap-start space-y-3 sm:w-auto">
            {/* A device bezel, drawn by the browser. The screenshots are real captures with the
                status bar cropped off, so without a frame they read as flat rectangles of UI
                rather than as a phone; the two-layer border and the lit top edge are what make
                the difference, and they cost no bytes. */}
            <div className="rounded-[1.9rem] bg-gradient-to-b from-zinc-600/80 via-zinc-800/80 to-zinc-900 p-[3px] shadow-[0_30px_70px_-32px_#000]">
              <div className="overflow-hidden rounded-[1.75rem] border border-black/70 bg-card">
                <Image
                  src={screen.src}
                  alt={screen.alt}
                  width={540}
                  height={1202}
                  className="h-auto w-full"
                  // Below the fold on every viewport; there is no reason to block the hero on them.
                  loading="lazy"
                  sizes="(min-width: 640px) 33vw, 100vw"
                />
              </div>
            </div>
            <figcaption className="space-y-1">
              <p className="text-sm font-medium">{screen.title}</p>
              <p className="text-sm text-muted-foreground">{screen.text}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
