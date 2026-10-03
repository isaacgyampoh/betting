# Deploying gameclaw (Cloudflare Workers + Supabase)

**Production:** https://gameclaw.win. This is the Cloudflare Worker `gameclaw`, built with `@opennextjs/cloudflare`. Supabase Postgres is in eu-west-1 (Ireland).

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
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `SPORTYBET_MODE`, `BETWAY_MODE` and `STATS_MODE`. These are safe to publish: the anon key is protected by RLS, and `pk_` keys are public by design.

### Secrets: `npx wrangler secret put <NAME>` (server-only, never committed)

| Secret | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler, port 6543. Used if Hyperdrive isn't bound. |
| `IP_HASH_SALT` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys (`sk_live_…`) |
| `API_FOOTBALL_KEY` | optional; dashboard.api-football.com |

The Supabase service_role key is never used. Don't add it.

### Automatic deploys (GitHub Actions)
Every push to `main` of the private repo `isaacgyampoh/betting` runs `.github/workflows/ci.yml`:
1. **check:** lint, typecheck, unit tests, integration tests (against a throwaway Postgres), `next build`, `pnpm cf:build`.
2. **deploy:** runs only after check passes, one at a time. It runs `prisma migrate deploy`, then `pnpm cf:build`, then `opennextjs-cloudflare deploy`, then a health check of `https://gameclaw.win`.

GitHub → repo → Settings → Secrets and variables → Actions holds three secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | restricted token **gameclaw-deploy (GitHub Actions)**: Workers Scripts/Routes edit, Hyperdrive read, Tail read, account/user read. Not the Global API Key. |
| `CLOUDFLARE_ACCOUNT_ID` | `d5c6a14614d6735d517c542ca2c15611` |
| `DIRECT_URL` | Supabase session pooler (port 5432), for migrations |

Pull requests run the checks but never deploy. For a manual deploy from your machine, run `CLOUDFLARE_API_TOKEN=… pnpm cf:deploy`.

### Hyperdrive (recommended)
Without it, every request opens a new TLS connection to Ireland. With it, pooled connections sit next to the database.
```bash
npx wrangler hyperdrive create gameclaw-db --caching-disabled \
  --connection-string="postgresql://postgres.qefedcphkmxuxjetmtqw:<PASSWORD>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
```
It's already created (`gameclaw-db`, query caching **disabled** so fresh reads are never stale) and bound as `HYPERDRIVE` in `wrangler.jsonc`. `lib/db.ts` uses it automatically.

### Checking a deploy from outside

`/api/v1/health` reports the commit it is serving, so "it is up" and "it is the new one" are
different questions. CI's smoke test waits for its own sha.

Nothing in the test suites can see Workers, Hyperdrive or the browser, and all three have broken
the live site while every test passed. After a deploy that touches auth, the database layer or the
root layout, be a user:

```bash
SERVICE_KEY=... node scripts/smoke-live.mjs
```

It signs up a throwaway account, confirms 18+, walks every tab on a phone-sized viewport, fails on
any browser error, and deletes the account. `SERVICE_KEY` is the Supabase service-role key.

For `pnpm cf:preview`, point the binding at a real database:
```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$(grep ^DIRECT_URL= .env.local | cut -d= -f2-)"
```

## Domain: gameclaw.win

The Worker owns `gameclaw.win` and `www.gameclaw.win` as **Custom Domains** (`routes` in `wrangler.jsonc`). Cloudflare creates the DNS records and certificates. `www` redirects to the apex in `worker.ts`.

Cutover from Vercel is done (30 Sep 2026): both hostnames are Worker custom domains, and the Vercel records and project domains have been removed.

**Cloudflare security settings (applied):**
- **SSL/TLS (applied):** Full (strict), Always Use HTTPS, Automatic HTTPS Rewrites, minimum TLS 1.2.
- **Rate limit (applied):** 30 requests per 10 s per IP on `/api/v1/*`, blocked for 10 s, excluding `/api/v1/webhooks/`. These are the free zone plan's limits.
- **Bot Fight Mode is deliberately OFF.** On the free zone plan it can't be skipped for a path, so it could challenge Paystack's webhook calls. Cloudflare's free managed WAF rules stay on. (With a Pro zone you could use Super Bot Fight Mode plus a skip rule for `/api/v1/webhooks/paystack`.)

## Third-party settings for gameclaw.win

**Supabase → Authentication → URL Configuration**
- Site URL: `https://gameclaw.win`
- Redirect URLs: `https://gameclaw.win/**`, `http://localhost:3000/**`, `http://localhost:8787/**`

**Google Cloud → Credentials → OAuth client**
- Authorized JavaScript origins: `https://gameclaw.win`
- Authorized redirect URIs: `https://qefedcphkmxuxjetmtqw.supabase.co/auth/v1/callback`
- OAuth consent screen:
  - Authorized domains: `gameclaw.win` and `supabase.co`
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

3. Once verified, go to Supabase → Authentication → **SMTP Settings**:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key
   - Sender `noreply@gameclaw.win`, name `gameclaw`
4. Raise the email rate limit to about 100 per hour.

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
