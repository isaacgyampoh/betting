import { describe, expect, it } from "vitest";

/**
 * A failed cache write must not fail the request.
 *
 * Found in production: the competition catalogue is a single response carrying about 1,250
 * leagues, and the first uncached call for it returned a 500 while every later call succeeded.
 * The data had already been fetched - only storing it failed - so a 500 threw away a good answer
 * in order to save a later one.
 */
describe("fetch then cache", () => {
  /** The shape of the call site: fetch, then try to cache, then return either way. */
  async function fetchAndCache<T>(fetch: () => Promise<T>, cache: (v: T) => Promise<void>): Promise<T> {
    const payload = await fetch();
    try {
      await cache(payload);
    } catch {
      // Logged in the real one; swallowed here as there.
    }
    return payload;
  }

  it("returns the data even when the cache write throws", async () => {
    const result = await fetchAndCache(
      async () => ["a", "b"],
      async () => {
        throw new Error("payload too large");
      },
    );
    expect(result).toEqual(["a", "b"]);
  });

  it("still returns the data when the write succeeds", async () => {
    let stored: string[] | null = null;
    const result = await fetchAndCache(
      async () => ["a"],
      async (v) => {
        stored = v;
      },
    );
    expect(result).toEqual(["a"]);
    expect(stored).toEqual(["a"]);
  });

  it("a failure to fetch is still a failure", async () => {
    // The guard is only around storing. Nothing here should hide a provider that actually failed.
    await expect(
      fetchAndCache(
        async () => {
          throw new Error("provider down");
        },
        async () => {},
      ),
    ).rejects.toThrow("provider down");
  });
});
