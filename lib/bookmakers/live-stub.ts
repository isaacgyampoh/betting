import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { BookmakerSlug } from "@/lib/bookmakers/types";

/** Placeholder until real endpoints are captured from the bookmaker's site. */
export async function liveNotImplemented(slug: BookmakerSlug, op: string): Promise<never> {
  logger.error("bookmaker.live_not_implemented", { bookmaker: slug, op });
  throw new AppError("BOOKMAKER_UNAVAILABLE", "This bookmaker isn't connected yet. Please try again later.");
}
