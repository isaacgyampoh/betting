import { AppError } from "@/lib/errors";
import type { BookmakerAdapter, BookmakerSlug } from "@/lib/bookmakers/types";

// Works out which bookmaker a pasted booking code belongs to:
//  1. keep bookmakers whose code format fits the code;
//  2. if several fit, try them in parallel and keep the ones that return a valid slip;
//  3. exactly one → that bookmaker; several → ask the user; none → the most useful error.

export type Detection<T> =
  | { kind: "found"; slug: BookmakerSlug; code: string; result: T }
  | { kind: "ambiguous"; slugs: BookmakerSlug[] };

// Which failure to report when no bookmaker returned a slip (most informative first).
const ERROR_PRIORITY = ["EXPIRED_CODE", "BOOKMAKER_UNAVAILABLE", "BOOKMAKER_NOT_CONNECTED", "INVALID_CODE"] as const;

export async function detectBookmaker<T>(
  rawCode: string,
  adapters: Pick<BookmakerAdapter, "slug" | "name" | "normalizeCode">[],
  load: (slug: BookmakerSlug, code: string) => Promise<T>,
): Promise<Detection<T>> {
  const candidates = adapters.flatMap((a) => {
    const code = a.normalizeCode(rawCode);
    return code ? [{ slug: a.slug, name: a.name, code }] : [];
  });
  if (candidates.length === 0) {
    throw new AppError("INVALID_CODE", "That doesn't look like a booking code. Check it and try again.");
  }

  const settled = await Promise.allSettled(candidates.map((c) => load(c.slug, c.code)));
  const hits = candidates.flatMap((c, i) => (settled[i].status === "fulfilled" ? [{ ...c, result: (settled[i] as PromiseFulfilledResult<T>).value }] : []));

  if (hits.length === 1) return { kind: "found", slug: hits[0].slug, code: hits[0].code, result: hits[0].result };
  if (hits.length > 1) return { kind: "ambiguous", slugs: hits.map((h) => h.slug) };

  const errors = settled.map((s) => (s as PromiseRejectedResult).reason);
  for (const code of ERROR_PRIORITY) {
    const match = errors.find((e) => e instanceof AppError && e.code === code);
    if (!match) continue;
    if (code === "INVALID_CODE") {
      throw new AppError("INVALID_CODE", `We couldn't find booking code ${candidates[0].code} on any supported bookmaker.`);
    }
    if (code === "BOOKMAKER_UNAVAILABLE") {
      const down = candidates.filter((_, i) => errors[i] instanceof AppError && errors[i].code === code).map((c) => c.name);
      throw new AppError("BOOKMAKER_UNAVAILABLE", `We couldn't check ${down.join(", ")} right now, and no other bookmaker has this code. Try again shortly.`);
    }
    if (code === "BOOKMAKER_NOT_CONNECTED") {
      throw new AppError(
        "BOOKMAKER_NOT_CONNECTED",
        "We can't open real booking codes yet while we finish connecting the bookmakers. Your code is probably fine.",
      );
    }
    throw match;
  }
  throw errors[0] instanceof AppError ? errors[0] : new AppError("INTERNAL", "Something went wrong. Please try again.");
}
