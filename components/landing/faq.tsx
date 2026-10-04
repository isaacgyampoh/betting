/**
 * The questions people actually ask before they trust a betting tool with a code.
 *
 * Every answer has to be true of the app today. Where the honest answer is a limit - three
 * bookmakers, not twenty; estimates, not tips - it says so. A page that oversells here is one the
 * first real slip will contradict.
 *
 * Rendered as <details> so it needs no JavaScript and the answers are in the HTML for search.
 */

type Entry = { q: string; a: string };

/** Named from the registry, so this answer cannot be ahead of what is actually connected. */
function entries(connected: string[]): Entry[] {
  const list =
    connected.length > 1
      ? `${connected.slice(0, -1).join(", ")} and ${connected[connected.length - 1]}`
      : connected[0];
  return [
    {
      q: "Which bookmakers does it work with?",
      a: list
        ? `${list} today. A code from any of them can be read and moved to any other, priced by the bookmaker you move it to. More are being connected, and this list comes from the app itself, so it is never ahead of what actually works.`
        : "None are connected at the moment, so codes cannot be read or moved right now. This answer comes from the app itself rather than from a list someone typed, so it is never ahead of what actually works.",
    },
    ...REST,
  ];
}

const REST: Entry[] = [
  {
    q: "Do I need an account with every bookmaker?",
    a: "No. A booking code is just a list of games, and reading one needs no account at all. You only need an account at the bookmaker where you finally place the bet.",
  },
  {
    q: "Where do the odds come from?",
    a: "From the bookmaker, at the moment you ask. Nothing here is modelled or made up. Prices move, so the slip you book is priced when it is booked, not when it was suggested.",
  },
  {
    q: "What is behind a pick?",
    a: "Counts of things that actually happened — \"both teams scored in 7 of Germany's last 10\" — alongside the bookmaker's own price. When there is no history for a market, the pick says so instead of dressing the price up as analysis.",
  },
  {
    q: "Are the daily picks guaranteed?",
    a: "No, and anyone who tells you otherwise is selling something. They are estimates with a stated chance. Every pick published stays on the public record, won or lost, and is never edited or removed — so you can check the claim rather than take it.",
  },
  {
    q: "What does it cost?",
    a: "Reading, converting and trimming a code is free, with no account needed to read one. Chat, slips built from today's prices, screenshot reads and the daily picks are on a plan, from a few cedis a day. Nothing renews on its own.",
  },
  {
    q: "How do I pay?",
    a: "MTN MoMo, Telecel Cash, AirtelTigo Money or card, through Paystack. We never see your card or MoMo PIN.",
  },
  {
    q: "Is there an app to download?",
    a: "No store, no download. It runs in the browser, and you can add it to your home screen so it opens full screen like an app.",
  },
];

export function Faq({ connected }: { connected: string[] }) {
  const items = entries(connected);
  return (
    <section aria-labelledby="faq" className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">Before you paste anything</p>
        <h2 id="faq" className="text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          Fair questions.
        </h2>
      </div>

      <div className="divide-y border-y">
        {items.map(({ q, a }) => (
          <details key={q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              <span>{q}</span>
              <span
                aria-hidden
                className="mt-1.5 size-2.5 shrink-0 rotate-45 border-r-2 border-b-2 border-muted-foreground transition-transform group-open:-rotate-135"
              />
            </summary>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
