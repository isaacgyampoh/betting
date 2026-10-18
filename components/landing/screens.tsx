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
    src: "/screens/live-centre.png",
    alt: "GameClaw's Live Centre, showing live matches grouped by competition with scores and match minutes",
    title: "Every live game, grouped",
    text: "Scores and minutes from the competitions people actually follow, without hunting for them.",
  },
  {
    src: "/screens/convert.png",
    alt: "GameClaw's Convert screen, listing which bookmakers can read and issue booking codes",
    title: "Move a code across",
    text: "It says plainly which bookmakers it can read and which it can book at, and why the others cannot.",
  },
  {
    src: "/screens/merge.png",
    alt: "GameClaw's Merge screen, showing selections from two different bookmakers being combined",
    title: "Combine two slips",
    text: "Pick the games you want from several codes and book the combination at one bookmaker.",
  },
];

export function Screens() {
  return (
    <section aria-labelledby="screens" className="gc-reveal space-y-6">
      <div className="space-y-2 text-center">
        <h2 id="screens" className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          The actual app
        </h2>
        <p className="mx-auto max-w-lg text-sm text-balance text-muted-foreground">
          Screenshots from a real phone, running against the same live data you would get.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {SCREENS.map((screen) => (
          <figure key={screen.src} className="space-y-3">
            <div className="overflow-hidden rounded-xl border bg-card">
              <Image
                src={screen.src}
                alt={screen.alt}
                width={324}
                height={720}
                className="h-auto w-full"
                // Below the fold on every viewport; there is no reason to block the hero on them.
                loading="lazy"
                sizes="(min-width: 640px) 33vw, 100vw"
              />
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
