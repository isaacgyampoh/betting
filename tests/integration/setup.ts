// Environment for integration tests. TEST_DATABASE_URL must point at a disposable database
// that has tests/integration/supabase-stubs.sql applied, then `prisma migrate deploy` + seed.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Set TEST_DATABASE_URL to a disposable Postgres (see tests/integration/README.md).");
if (/supabase\.(co|com)/.test(url)) throw new Error("Refusing to run integration tests against Supabase.");

process.env.DATABASE_URL = url;
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.MOCK_LATENCY_MS = "0";
// Counts queries, so tests can assert how many round trips a page costs (see lib/db.ts).
process.env.DB_QUERY_LOG = "1";
