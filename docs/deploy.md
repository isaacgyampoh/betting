# Deploying gameclaw (Cloudflare Workers + Render)

**Production:** two deployments of the same Next application, and which one owns the database is the
thing to keep straight.

| | Serves | Database |
|---|---|---|
| Cloudflare Worker `gameclaw` | https://gameclaw.win — the marketing site | **none.** `/api/v1` is forwarded to the API (`worker.ts`) |
| Render `gameclaw-api` | https://gameclaw-api.onrender.com — the API the phone apps call, and `/admin` | `gameclaw-db`, Postgres 17 in Frankfurt |

Render Postgres is the only production database. It accepts no external connections, which is why
the Worker has no binding and forwards instead — see the comment at the end of `wrangler.jsonc`.
Supabase was retired; `docs/supabase-retirement.md` has the history.

Plan: **Workers Paid ($5/month) is required.** The Worker is ~4.9 MiB gzipped (the free limit is 3 MiB), and the free plan's 10 ms CPU per request is too little for server-rendered Next.js. The paid plan includes Hyperdrive, Cron Triggers and Workers Logs.

## How it fits together

| Piece | Where |
|---|---|
| Worker config | `wrangler.jsonc`: custom domains `gameclaw.win` and `www.gameclaw.win`, Smart Placement, logs, cron, public vars |
| Entry point | `worker.ts`: wraps the OpenNext output; `www` → apex 308; daily cron → `/api/v1/cron/cleanup` with `CRON_SECRET` |
| Build | `pnpm cf:build` → Workers Prisma client → `opennextjs-cloudflare build`, with `NEXT_PUBLIC_*` taken from `wrangler.jsonc` vars (so `.env.local` can't leak into production) |
| Cache | `open-next.config.ts`: static-assets incremental cache. There's no ISR, so no R2/KV bucket is needed. |
| Database | `lib/db.ts`: one Prisma client **per request** on Workers, via Hyperdrive if bound, else `DATABASE_URL`. One client per process on Node (`pnpm dev`, tests, scripts). |
| Prisma client | `scripts/prisma-generate.mjs`: the Workers build generates `runtime = "cloudflare"`; everything else uses the Node client |
| Auth guards | Each protected section has a `layout.tsx` guard (`requireAdultPage`), with its `loading.tsx` inside, so signed-out visitors get a real 307. A client `SessionKeeper` refreshes sessions. There's no `proxy.ts`; Node middleware is experimental on OpenNext. |
| Migrations | `scripts/migrate-on-deploy.mjs`: `prisma migrate deploy` (never `migrate dev`), only in production-branch builds or with `MIGRATE=1` |

## Commands

```bash
pnpm dev            # Next.js dev server on Node, as before
pnpm cf:preview     # production build on the real Workers runtime at http://localhost:8787 (uses .dev.vars)
pnpm cf:deploy      # from your machine: migrate → build → deploy (needs `npx wrangler login` once)
pnpm cf:typegen     # regenerate cloudflare-env.d.ts after changing wrangler.jsonc
```

For local preview secrets, copy `.dev.vars.example` to `.dev.vars` (git-ignored). Keep a dummy Paystack key there.

## Configuration

### Public values: `wrangler.jsonc` → `vars` (committed)
`NEXT_PUBLIC_SITE_URL`, `GC_DATA_API_BASE`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `SPORTYBET_MODE`, `MSPORT_MODE`, `FOOTBALLCOM_MODE`, `BETWAY_MODE`, `STATS_MODE` and `ALLOW_SAMPLE_DATA`. These are safe to publish: `pk_` keys are public by design and the rest are switches, not secrets.

### Secrets: `npx wrangler secret put <NAME>` (server-only, never committed)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Only used off Cloudflare. The website Worker must not query Postgres — `worker.ts` forwards `/api/v1` to the API. |
| `IP_HASH_SALT` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys (`sk_live_…`) |
| `API_FOOTBALL_KEY` | optional; dashboard.api-football.com |

All database access goes through Prisma. There is no Supabase project, so no Supabase key belongs anywhere here.

### Rotating any of these

See [rotating-secrets.md](rotating-secrets.md): every credential, where it lives, and the order to
replace it in without taking the site down. A credential that has been pasted into a chat, a
screenshot or a commit is one someone else may hold, and rotating is the only fix.

### Automatic deploys (GitHub Actions)
Every push to `main` of the private repo `isaacgyampoh/betting` runs `.github/workflows/ci.yml`:
1. **check:** lint, typecheck, unit tests, integration tests (against a throwaway Postgres), `next build`, `pnpm cf:build`.
2. **deploy:** runs only after check passes, one at a time. It runs `prisma migrate deploy`, then `pnpm cf:build`, then `opennextjs-cloudflare deploy`, then a health check of `https://gameclaw.win`.

GitHub → repo → Settings → Secrets and variables → Actions holds three secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | restricted token **gameclaw-deploy (GitHub Actions)**: Workers Scripts/Routes edit, Hyperdrive read, Tail read, account/user read. Not the Global API Key. |
| `CLOUDFLARE_ACCOUNT_ID` | `d5c6a14614d6735d517c542ca2c15611` |
| `DIRECT_URL` | `gameclaw-db`, for `prisma migrate deploy`. The external Frankfurt hostname from CI. |

Pull requests run the checks but never deploy. For a manual deploy from your machine, run `CLOUDFLARE_API_TOKEN=… pnpm cf:deploy`.

### Hyperdrive: removed, on purpose

There was a Hyperdrive binding (`673d415bb1174f8092e5649a5675516a`) pointing at the Supabase
project. When that project was deleted every `/api/v1` route on gameclaw.win began answering 500 or
503 while the identical route on Render answered correctly, and both cron jobs failed silently every
morning.

It was not re-pointed at `gameclaw-db`, because Hyperdrive egresses from Cloudflare's shared address
ranges: allowing it in means opening the database to ranges every Cloudflare customer shares.
`worker.ts` forwards an allowlisted set of `/api/v1` paths to the API instead, which already has a
private connection. One process talks to Postgres.

Consequence worth knowing: `opennextjs-cloudflare deploy` no longer needs
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` set to resolve a binding.

### Checking a deploy from outside

`/api/v1/health` reports the commit it is serving, so "it is up" and "it is the new one" are
different questions. CI's smoke test waits for its own sha.

Nothing in the test suites can see the deployed Worker, and that gap has broken the live site while
every test passed. After any deploy, run:

```bash
node scripts/smoke-live.mjs
```

No credentials, nothing written. It checks the marketing pages, that `/api/v1/health` comes back
`ok` — which only happens if the request reached Render, since the Worker has no database of its own
— that the paths outside the allowlist are refused with 404 rather than served as a 500, and that
the redirects still hold. It checks the API directly last, so a failure can be attributed to one
side or the other.

Before deploying the Worker, confirm the allowlist in `worker.ts` still matches real routes:

```bash
GC_LIVE=1 pnpm vitest run tests/worker/api-forward.live.test.ts
```

## Domain: gameclaw.win

The Worker owns `gameclaw.win` and `www.gameclaw.win` as **Custom Domains** (`routes` in `wrangler.jsonc`). Cloudflare creates the DNS records and certificates. `www` redirects to the apex in `worker.ts`.

Cutover from Vercel is done (30 Sep 2026): both hostnames are Worker custom domains, and the Vercel records and project domains have been removed.

**Cloudflare security settings (applied):**
- **SSL/TLS (applied):** Full (strict), Always Use HTTPS, Automatic HTTPS Rewrites, minimum TLS 1.2.
- **Rate limit (applied):** 30 requests per 10 s per IP on `/api/v1/*`, blocked for 10 s, excluding `/api/v1/webhooks/`. These are the free zone plan's limits.
- **Bot Fight Mode is deliberately OFF.** On the free zone plan it can't be skipped for a path, so it could challenge Paystack's webhook calls. Cloudflare's free managed WAF rules stay on. (With a Pro zone you could use Super Bot Fight Mode plus a skip rule for `/api/v1/webhooks/paystack`.)

## Third-party settings for gameclaw.win

Sign-in is GameClaw's own: the client obtains an ID token from Google or Apple and posts it to
`/api/v1/auth/google` or `/api/v1/auth/apple`, which verifies it against the provider's JWKS and
issues our session. There is no auth provider to configure, and no redirect URL — the native flows
do not use one.

**Google Cloud → Credentials → OAuth client**
- Authorized JavaScript origins: `https://gameclaw.win` (for the admin dashboard's Google button)
- Authorized redirect URIs: none needed; the ID token flow does not redirect
- OAuth consent screen:
  - Authorized domains: `gameclaw.win`
  - Homepage `https://gameclaw.win`; privacy `https://gameclaw.win/privacy`; terms `https://gameclaw.win/terms`
  - Then **Publish app**.

**Paystack → Settings → API Keys & Webhooks**
- Webhook URL: `https://gameclaw.win/api/v1/webhooks/paystack`. **Only if this Paystack account isn't already sending webhooks to another app**, since there is one webhook URL per account. The app works without it: `/billing/callback` verifies every payment with Paystack.
- Callback URL: leave empty. The app sends `https://gameclaw.win/billing/callback` with each payment.

**Email via Resend (noreply@gameclaw.win)**
1. At resend.com, go to Domains → Add `gameclaw.win` (region: Ireland).
2. Add the DNS records Resend shows, all DNS-only:

   | Type | Name | Content |
   |---|---|---|
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (priority 10) |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | the DKIM value from Resend |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@gameclaw.win` |

3. Nothing in the application sends email. This domain setup exists for replies from
   `support@gameclaw.win`, which Cloudflare Email Routing forwards — the application has no SMTP
   configuration and no transactional email, because sign-in is an ID token rather than a magic
   link.

## After each deploy

- [ ] `https://gameclaw.win/api/v1/health` returns `{"data":{"status":"ok",…}}`
- [ ] Sign in with an email link or code, then the 18+ step, then `/slip`
- [ ] Load `BC7K2Q` → convert to Betway → trim to 5
- [ ] AI chat: *"Convert SportyBet BC7K2Q to Betway and remove anything above 2.0"*
- [ ] `/pricing` → Day Pass → Paystack checkout opens (GHS 5)
- [ ] Install the app on your phone

## Operating it
- **Logs:** Cloudflare → Workers & Pages → gameclaw → **Logs**. JSON lines are searchable by `msg`:
  - `api.unhandled`, `ai.*`, `paystack.*`, `bookmaker.*`
  - `cron.cleanup_triggered`
- **AI spend per day:**
  ```sql
  select date_trunc('day', created_at) d, sum(cost_micro_usd)/1e6 usd from usage_logs group by 1 order by 1 desc;
  ```
- **Prices and limits:** edit the `plans` table. No deploy is needed.

## The API Worker on Cloudflare: retired

There was a second Cloudflare Worker, `gameclaw-api`, on `gameclaw-api.nanagyams99.workers.dev`,
serving `/api/*` for the Flutter app from `worker.api.ts` and `wrangler.api.jsonc`. It was deleted
on 2026-10-31, along with the Hyperdrive configuration it bound.

It was superseded rather than failed: the API moved to Render, which has a private connection to
`gameclaw-db`. After that the Cloudflare copy was a second full deployment of the application,
publicly reachable and permanently broken — its `/api/v1/health` answered 503
`database_unreachable` right up to deletion, because the Hyperdrive config it used pointed at a
Supabase project that no longer exists. Nothing referenced it: every build script, workflow and
Dart default already named `gameclaw-api.onrender.com`.

`worker.api.ts`, `wrangler.api.jsonc` and the `cf:build:api` / `cf:deploy:api` scripts went with
it. The website Worker `gameclaw` and both of its domains were untouched, and it is the only
Cloudflare Worker now.

## Endpoints the mobile app needs

The app calls exactly seven, all under `/api/v1`:

| Endpoint | Auth |
|---|---|
| `GET /matches?date=` | bearer + 18+ |
| `GET /matches/{id}` | bearer + 18+ |
| `GET /picks` | optional bearer |
| `GET /picks/track-record` | public |
| `POST /me/age-confirmation` | bearer |
| `GET /ai/allowance` | bearer + 18+ |
| `POST /ai/chat` | bearer + 18+ |

Auth is `Authorization: Bearer <GameClaw access token>`, issued by `/api/v1/auth/google` or
`/api/v1/auth/apple` and verified locally in `lib/auth.ts` with our own signing secret — no network
call and no third party. The app holds nothing else.
