import { describe, expect, it } from "vitest";
import { sslFor } from "@/lib/db";

/**
 * Which hosts get relaxed certificate checking, and which must not.
 *
 * Render's Postgres presents a self-signed certificate on a private network, so the chain cannot
 * be verified against a public CA. Everything reached over the public internet must keep
 * verifying - a blanket rejectUnauthorized:false would silently weaken Supabase too.
 */
describe("TLS settings per host", () => {
  it("relaxes verification for a Render internal hostname", () => {
    expect(sslFor("postgresql://u:p@dpg-db9n7d7btjjs73cbok6g-a/gameclaw")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("keeps verifying Render's EXTERNAL hostname, which has a real certificate", () => {
    // Verified from a laptop during the migration, with Prisma, over the public internet. Only
    // the internal endpoint is self-signed, so only it gets relaxed.
    expect(
      sslFor("postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com:5432/gameclaw"),
    ).toBeUndefined();
  });

  it("leaves Supabase alone", () => {
    expect(sslFor("postgresql://u:p@aws-1-eu-west-1.pooler.supabase.com:5432/postgres")).toBeUndefined();
  });

  it("leaves an arbitrary public host alone", () => {
    expect(sslFor("postgresql://u:p@db.example.com:5432/app")).toBeUndefined();
  });

  it("does not throw on a connection string it cannot parse", () => {
    expect(sslFor("not a url")).toBeUndefined();
  });

  it("is not fooled by a host that merely looks internal", () => {
    // The internal form has no dots at all; anything routable on the public internet does.
    expect(sslFor("postgresql://u:p@dpg-abc.evil.test:5432/app")).toBeUndefined();
    expect(sslFor("postgresql://u:p@render.com.evil.test:5432/app")).toBeUndefined();
  });
});
