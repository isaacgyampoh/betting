import { connectedBookmakers } from "@/lib/bookmakers/registry";
import { BOOKMAKER_SLUGS } from "@/lib/bookmakers/types";

// Which bookmakers we really work with, read from the registry rather than typed into the page.
// A marketing page that lists bookmakers by hand drifts from the truth the moment one is connected
// or turned off; this one cannot.

export function Bookmakers() {
  const connected = connectedBookmakers().filter((b) => b.capabilities.loadCode);
  const coming = BOOKMAKER_SLUGS.length - connected.length;

  return (
    <section aria-labelledby="bookmakers" className="rounded-lg border bg-card p-6 sm:p-8">
      <div className="space-y-1 text-center">
        <h2 id="bookmakers" className="text-2xl font-semibold tracking-tight text-balance">
          {connected.length > 0
            ? `${connected.length} bookmaker${connected.length === 1 ? "" : "s"} connected`
            : "Connecting the bookmakers"}
        </h2>
        <p className="mx-auto max-w-lg text-sm text-balance text-muted-foreground">
          Paste a code from any of these and move it to any other, with that bookmaker&apos;s own prices.
          {coming > 0 && ` ${coming} more are being connected.`}
        </p>
      </div>

      {connected.length > 0 && (
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {connected.map((b) => (
            <li key={b.slug} className="rounded-lg border bg-background px-4 py-2.5 text-sm font-medium">
              {b.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
