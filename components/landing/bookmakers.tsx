import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";

// Which bookmakers we really work with, read from the registry rather than typed into the page.
// A marketing page that lists bookmakers by hand drifts from the truth the moment one is connected
// or turned off; this one cannot.

export function Bookmakers() {
  const connected = connectedBookmakers().filter((b) => b.capabilities.loadCode);
  const coming = BOOKMAKER_SLUGS.length - connected.length;

  return (
    // Inverted on purpose: one dark band gives a long flat page a spine, without reaching for a
    // gradient or a shadow.
    <section aria-labelledby="bookmakers" className="rounded-xl bg-foreground px-6 py-10 text-background sm:px-8 sm:py-14">
      <div className="space-y-2 text-center">
        <h2 id="bookmakers" className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
          {connected.length > 0
            ? `${connected.length} bookmaker${connected.length === 1 ? "" : "s"} connected`
            : "Connecting the bookmakers"}
        </h2>
        <p className="mx-auto max-w-lg text-sm text-balance opacity-70">
          Paste a code from any of these and move it to any other, with that bookmaker&apos;s own prices.
          {coming > 0 && ` ${coming} more are being connected.`}
        </p>
      </div>

      {connected.length > 0 && (
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {connected.map((b) => (
            <li
              key={b.slug}
              className="rounded-lg border border-background/20 px-5 py-3 text-base font-medium tracking-tight"
            >
              {b.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
