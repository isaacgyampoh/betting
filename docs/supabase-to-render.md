# Moving off Supabase

Audit completed 2026-10-17 against the live production database. Nothing has been migrated and no
Render resource has been created: the last section says why, and what it would cost.

The headline is better than expected. Supabase is doing far less here than the dependency list
suggests, and the data is small.

---

## 1. What actually depends on Supabase

### Not used at all

Checked, empty, and referenced nowhere in the codebase:

| | Rows |
|---|---|
| Supabase Storage (`storage.objects`, `storage.buckets`) | 0 |
| Realtime (`realtime.subscription`) | 0 |
| Vault (`vault.secrets`) | 0 |
| Edge Functions | none deployed, none called |
| GraphQL / PostgREST | the app never calls them |

The Flutter app does **not** bundle the Supabase SDK. It talks to five REST endpoints with plain
Dio. That is the whole mobile coupling, and it is much easier to replace than an SDK would be.

### Must be replaced

**Token verification — one function.** `lib/auth.ts` resolves a caller by calling
`supabase.auth.getClaims(bearer)`. Every protected route reaches the user through it. That single
call is the real Supabase Auth dependency on the server.

**Five auth endpoints the app calls** (`gameclaw_app/lib/data/auth_client.dart`):

| Endpoint | Used for | After the move |
|---|---|---|
| `POST /token?grant_type=id_token` | Google sign-in | the only one that matters |
| `POST /token?grant_type=refresh_token` | session refresh | needs an equivalent |
| `POST /logout` | revoke a refresh token | needs an equivalent |
| `POST /token?grant_type=password` | email sign-in | can be dropped — see §3 |
| `POST /signup` | email sign-up | already broken; its mailer refuses every signup |

### Must be dropped, not migrated

`prisma/migrations/20260930000100_auth_rls/migration.sql` contains three things tied to Supabase's
`auth` schema, which will not exist on Render:

1. `profiles.id → auth.users.id` foreign key. Must be dropped.
2. `on_auth_user_created` trigger that creates a profile row. **Nothing depends on it** —
   `getProfile()` in `lib/auth.ts` already upserts the profile itself, with a comment saying it
   exists for exactly this case. Verified by reading the code path, not assumed.
3. Row Level Security on every public table. The migration's own header explains why this can go:
   *"Prisma connects as the table owner and bypasses RLS; API routes enforce access themselves.
   RLS protects data reached with the anon key via the Supabase client (PostgREST)."* Remove
   PostgREST and the policies protect nothing that is still reachable. Authorisation is already
   server-side.

Dropping RLS is safe **only** because no client ever reaches the database directly. That stays
true in the target architecture and must not quietly stop being true.

### Stays where it is

| | Why |
|---|---|
| Cloudflare DNS, `gameclaw.win`, `www.gameclaw.win` | marketing site, out of scope, untouched |
| Cloudflare cron (`30 3 * * *`, `0 7 * * *`) | cleanup and daily picks; authenticated with `CRON_SECRET`; can move later or stay |
| API-Football | unaffected — it is an HTTP provider behind a cache table |
| Bookmaker adapters | unaffected — plain HTTP, no Supabase anywhere |
| Firebase push | unaffected. Note `FCM_SERVICE_ACCOUNT` is **not set**, so nothing can send today |

---

## 2. The data

Live row counts, 2026-10-17. This is a small database.

```
team_logos  8532   selections 296   usage_logs 771   stats_cache 518
slips         47   profiles    13   auth.users  13   everything else < 120
```

`team_logos` and `stats_cache` are **caches** — 9,050 of the ~10,500 rows. They rebuild themselves
from the provider and do not need to migrate at all; copying them is a convenience that avoids a
cold first day, not a requirement.

The rows that genuinely matter: 13 profiles, 47 slips, 296 selections, 2 subscriptions,
8 payments, 2 referral rewards, 1 device token.

**Postgres 17.6** on Supabase. Extensions in use: `pgcrypto`, `uuid-ossp`, `plpgsql`,
`pg_stat_statements` — all standard and all available on Render. The only non-portable one is
`supabase_vault`, which holds nothing.

### Backup — taken and verified

```
~/gameclaw-backups/20261017-114921/gameclaw-full.dump   2.8 MB, pg_dump -Fc
```

Verified by restoring into a scratch local database and comparing every table:

> 22 public tables plus `auth.users` — **every row count matches**.

Three restore errors, all `supabase_vault`, which is a Supabase-proprietary extension containing
zero rows and referenced nowhere in the codebase. Nothing of GameClaw's failed to restore.

This dump lives outside the repository on purpose and must stay out of it.

---

## 3. What happens to the 13 existing users

This is the question with the best answer in the whole audit.

| Sign-in method | Users | Hold any data? | After the move |
|---|---|---|---|
| Google (gmail.com) | 7 | 45 of 47 slips, both subscriptions | **sign in exactly as before** |
| Email only (example.com) | 5 | 2 slips | test accounts |
| Email only (gameclaw.win) | 1 | none, never signed in | seed account |

**Every real user already has a Google identity.** The only email-only accounts are on
`example.com` — the reserved documentation domain — and one seed address. So there is no password
migration problem, because there are no real passwords to migrate.

All 7 Google identities store a stable numeric `sub` and an email in `auth.identities`. That is
exactly what is needed to link an existing profile to a new session: match on `sub`, fall back to
email. Profile ids are preserved, so every slip, subscription and payment stays attached.

**What cannot be carried over: sessions.** Supabase's refresh tokens are signed with Supabase's
JWT secret and mean nothing to a new issuer. Every signed-in user is signed out once at cutover
and signs in again with Google. For 7 people with working Google accounts that is one tap. It
should be said plainly rather than engineered around.

---

## 4. Target architecture

```
Flutter app ──HTTPS──> GameClaw API (Render Web Service)
                          ├── Google OIDC: verify id_token, issue our own session
                          ├── /api/v1/*  (ported from the Worker, same code)
                          └── /admin/*   (server-rendered, admin-only)
                                  │
                          Render PostgreSQL (private network)

Cloudflare: DNS + gameclaw.win + www.gameclaw.win  — untouched
```

**How much code moves unchanged?** Nearly all of it. The API is Next.js App Router running on
Workers through `@opennextjs/cloudflare`; Render runs Next.js natively. The route handlers,
services, bookmaker adapters, stats provider, rate limiter and Prisma schema are all
runtime-agnostic. What is Worker-specific is confined to `lib/db.ts` (the per-request client and
Hyperdrive binding) and `worker.api.ts`.

**Things that must not be lost in the port**, each of which exists for a reason recorded in the
code: the provider concurrency limiter, the `stats_cache` TTLs including the settled-match
distinction, the capability memo, the booking idempotency guard, the read-back check in
`createCode`, the public-browse rate limit, and the crest memo added today.

**Admin dashboard in the same service.** It is Next.js already; `/admin` is server-rendered pages
behind a server-side role check. No second service, no extra cost, no separate deployment.
`profiles.role` already exists with 2 ADMIN rows — but it is currently used only to grant paid
features for free. There is no admin authorisation helper and no admin route today, so §5 of the
brief is genuinely greenfield on top of a column that already exists.

---

## 5. Cost — and why I stopped here

Taken from Render's own pricing page, 2026-10-17.

| | Plan | Cost |
|---|---|---|
| PostgreSQL | Free — 0.1 CPU, 256 MB, **30-day limit** | $0, then it expires |
| PostgreSQL | **Basic-256mb** — 0.1 CPU, 256 MB, 100 connections | **$6/month** |
| PostgreSQL | Basic-1gb — 0.5 CPU, 1 GB | $19/month |
| Storage | | $0.25/GB/month |
| Web Service | Free — 0.1 CPU, 512 MB, **spins down when idle** | $0 |
| Web Service | **Starter** — 0.5 CPU, 512 MB | **$7/month** |
| Web Service | Standard — 1 CPU, 2 GB | $25/month |

**Render's free Postgres expires 30 days after creation.** It is a trial, not a tier. A production
database cannot live on it.

**The free web service spins down when idle**, so the first request after a quiet period pays a
cold start measured in tens of seconds. For an app whose warm match centre is now 0.65s, that is
not a plausible production tier.

So the realistic minimum is **$13/month**: Basic-256mb Postgres ($6) + Starter web service ($7).
Storage is negligible at this size. The admin dashboard adds nothing because it shares the service.

### This is an increase, and it should be a deliberate one

Today: Cloudflare Workers Paid **$5/month**, Supabase on its free tier.
After: Render **$13/month**, and Cloudflare Workers Paid still needed for `gameclaw.win`.

So the running cost roughly **triples**, to about $18/month all in. That buys: no Supabase, one
place to look, a real admin dashboard, and a database reachable only from the backend. Whether
that is worth $13/month more is a decision, not a technical question, which is why nothing has
been created.

**Nothing paid will be created without your say-so.**

---

## 6. What can be built before you decide

All of it except the deployment, and none of it costs anything:

1. Google OIDC verification and our own session issuing, as a replacement for
   `supabase.auth.getClaims` — testable against the scratch database already restored locally.
2. The migration SQL that drops the `auth.users` foreign key, the trigger and the RLS policies.
3. The admin dashboard, against local Postgres.
4. The regression suite for every item in Phase 6.

Then the cutover is: create the two Render resources, restore the dump, deploy, point the app at
the new base URL, verify, and keep Supabase untouched for the agreed verification period.

---

## 8. The migration, as actually run

Executed 2026-10-17 against the real Render account. Supabase untouched throughout and still
serving production.

### What was created

| | | Cost |
|---|---|---|
| `gameclaw-db` | Render Postgres 17.11, Frankfurt, Basic-256mb, 15 GB disk | **$6/month** |

Frankfurt rather than the Oregon one of the other projects in the workspace uses: the users are
in Ghana and the database it replaces is in `eu-west-1`. The workspace already runs `zazi-web`
and `zazi-api` in Frankfurt, so this is consistent with what is there.

### The order that worked, and the two that did not

`prisma migrate deploy` cannot replay `20260930000100_auth_rls` without something called
`auth.users` to point at. So the sequence is: scaffold the stub, migrate, then remove the
scaffolding and the coupling together.

1. `psql -f tests/integration/supabase-stubs.sql`
2. `prisma migrate deploy` — 16 migrations
3. `psql -f prisma/cutover/001-leave-supabase.sql`
4. `pg_restore --data-only` from the verified backup
5. Backfill `identities` and `profiles.last_sign_in_at` from Supabase's `auth` schema

**The data restore fails if run in one pass.** Two reasons, both worth knowing:

- `bookmakers` and `plans` are seeded by migrations, with different ids from production's. The
  restore collides on `bookmakers_slug_key` and `plans_code_key`. Production is the source of
  truth, so those two tables are emptied first and restored from the dump.
- `pg_restore`'s own table ordering put several children before their parents, so ten more tables
  failed on foreign keys that were fine. Restoring parent-first fixes it:
  `plans, bookmakers, teams, team_aliases, events, bookmaker_events, slips, selections,
  code_cache, subscriptions, payments, daily_pick_legs, device_tokens`.

**`DROP SCHEMA auth RESTRICT` does not mean what it looks like.** It refuses any schema that is
not empty, including one holding only its own scaffolding, so it cannot express "drop this unless
something outside still needs it". The cutover script checks for foreign keys into `auth`
explicitly and then uses CASCADE, refusing loudly if it finds any.

### Verification

Row counts, every table:

> **19 of 21 identical.** The two that differ are `usage_logs` (775 vs 771) and `stats_cache`
> (522 vs 518), and both are accounted for: production is still live, and exactly 4 usage rows
> and 6 cache rows were written *after* the backup was taken at 11:49. `usage_logs` had 771 rows
> at backup time, which is what Render holds.

Content, not just counts — md5 over the ordered rows of each table:

| | |
|---|---|
| profile ids + emails | match |
| slip ids + booking codes | match |
| selection ids | match |
| subscriptions, payments | match |
| bookmakers, plans, teams, events | match |

Identity: **7 Google identities and 12 of 13 last-sign-in times** carried across, matching
Supabase exactly. The 13th profile has never signed in.

### Running the application against it

The dev server was pointed at the Render database and exercised:

```
/health          ok
/matches         1668 fixtures, 32 leagues, signed out
/competitions    171 countries
/bookmakers      9 entries; SportyBet and Football.com still read/book/price
/me, /slips      401 without a token
/auth/google     rejects an unverifiable token
/auth/refresh    rejects an unknown refresh token
```

**`sslmode=require` is mandatory.** Render refuses an unencrypted connection with
`28000: SSL/TLS required`, and the connection string it hands out does not include the parameter,
so Prisma connects in the clear and every query fails. The service's `DATABASE_URL` must carry
it. This cost a confusing `database_unreachable` before it was found.

### Access control

Render denies every external address by default — the allow list starts empty, which is why the
first connection attempt died with `SSL connection has been closed unexpectedly` rather than an
auth error. One address is allow-listed at the moment, this machine, for the migration.

**That entry must be removed once the API service is running**, because the service reaches the
database over Render's private network and needs no public exposure at all.

---

## 7. The blocker that outranks all of this

**Google sign-in does not work on Android today.** The account chooser appears and token issuance
fails with `[16] Account reauth failed`, because no Android OAuth client is registered for
`win.gameclaw.app`. See `docs/release-signing.md` §5.

Every real user in the table above signs in with Google. An authentication system built on Google
OIDC cannot be accepted until Google sign-in actually succeeds on the device once. That console
action is yours and it gates Phase 4's acceptance test.
