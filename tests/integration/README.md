# Integration tests

Run the real services (load → convert → edit, rate limits, RLS) against a disposable local Postgres.

```bash
pnpm prisma dev --name gameclaw-test --detach          # prints a postgres:// URL
export TEST_DATABASE_URL='postgres://postgres:postgres@localhost:<port>/template1?sslmode=disable'
psql "$TEST_DATABASE_URL" -f tests/integration/supabase-stubs.sql   # or: pnpm test:int:setup
DIRECT_URL="$TEST_DATABASE_URL" pnpm prisma migrate deploy
DIRECT_URL="$TEST_DATABASE_URL" pnpm db:seed
pnpm test:int
```

`supabase-stubs.sql` fakes the few Supabase objects the migrations reference (auth schema, `auth.uid()`, roles).
The setup refuses to run against a Supabase URL.
