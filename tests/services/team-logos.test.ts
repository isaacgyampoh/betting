import { beforeEach, describe, expect, it, vi } from "vitest";

type LogoRow = { key: string; name: string; logoUrl: string };
// Typed through the signature so the assertions below can read `.data` without casting; the
// argument itself is only ever inspected via createMany.mock.calls.
const createMany =
  vi.fn<(args: { data: LogoRow[]; skipDuplicates?: boolean }) => Promise<{ count: number }>>(
    async () => ({ count: 0 }),
  );

vi.mock("@/lib/db", () => ({ db: { teamLogo: { createMany, findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/services/events", () => ({ getAliasIndex: async () => new Map<string, string>() }));

const { rememberLogos, forgetRememberedLogos } = await import("@/lib/services/team-logos");

/** A day's fixture list, in the shape rememberLogos reads. */
const fixtures = (names: [string, string][]) =>
  names.map(([home, away], i) => ({
    id: i,
    home: { id: i * 2, name: home, logo: `https://crests/${home}.png` },
    away: { id: i * 2 + 1, name: away, logo: `https://crests/${away}.png` },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;

/**
 * The write is `skipDuplicates`, so offering the same 3,300 crests again inserts nothing - but
 * the caller still waited for Postgres to discard every one of them. Measured at 362-1118ms of a
 * 1.3s request, on every request, for no new rows.
 */
describe("crests are not re-offered to the database on every request", () => {
  beforeEach(() => {
    createMany.mockClear();
    forgetRememberedLogos();
  });

  it("writes the first time it sees a fixture list", async () => {
    await rememberLogos(fixtures([["Arsenal", "Chelsea"]]));
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it("does not touch the database at all the second time", async () => {
    const day = fixtures([["Arsenal", "Chelsea"]]);
    await rememberLogos(day);
    createMany.mockClear();
    await rememberLogos(day);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes only what is new when one fixture is added", async () => {
    await rememberLogos(fixtures([["Arsenal", "Chelsea"]]));
    createMany.mockClear();
    await rememberLogos(fixtures([["Arsenal", "Chelsea"], ["Spurs", "Everton"]]));
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0].data.map((r) => r.key).sort())
      .toEqual(["everton", "spurs"]);
  });

  it("remembers nothing when the write fails, so the crests are retried", async () => {
    createMany.mockRejectedValueOnce(new Error("connection lost"));
    await rememberLogos(fixtures([["Arsenal", "Chelsea"]]));
    createMany.mockClear();
    await rememberLogos(fixtures([["Arsenal", "Chelsea"]]));
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});
