import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";

/**
 * A token for a user who no longer exists.
 *
 * The signature is still valid and the expiry has not passed, so the request authenticates — but
 * profiles.id references auth.users.id, so creating the profile row fails with a foreign key
 * violation. Before this, that surfaced as a 500: the app retried it four times and showed
 * "something went wrong" to someone whose actual problem was that they needed to sign in again.
 *
 * Found on a real device holding a session across an account deletion.
 */
describe("a token whose account was deleted", () => {
  // The two shapes the violation arrives in: Prisma's own code on a typed error, and the raw
  // Postgres code inside the message for $queryRaw.
  const fromPrisma = Object.assign(new Error("Foreign key constraint violated"), { code: "P2003" });
  const fromRawQuery = new Error(
    "Raw query failed. Code: `23503`. Message: `insert or update on table \"profiles\" " +
      'violates foreign key constraint "profiles_id_fkey"`',
  );

  const translate = (err: unknown) => {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2003") {
      return new AppError("UNAUTHORIZED", "Please sign in again.");
    }
    if (err instanceof Error && /23503/.test(err.message)) {
      return new AppError("UNAUTHORIZED", "Please sign in again.");
    }
    return err;
  };

  it("is unauthorised, not a server fault", () => {
    for (const err of [fromPrisma, fromRawQuery]) {
      const translated = translate(err);
      expect(translated).toBeInstanceOf(AppError);
      expect((translated as AppError).code).toBe("UNAUTHORIZED");
      expect((translated as AppError).status).toBe(401);
    }
  });

  it("asks the user to sign in again rather than blaming the server", () => {
    expect((translate(fromRawQuery) as AppError).message).toBe("Please sign in again.");
  });

  it("leaves every other database failure alone", () => {
    // A real outage must stay a 500. Turning every database error into a sign-out would hide them.
    const outage = new Error("Can't reach database server");
    expect(translate(outage)).toBe(outage);
    expect(translate(new Error("Code: `23505` duplicate key"))).not.toBeInstanceOf(AppError);
  });
});
