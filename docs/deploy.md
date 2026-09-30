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

### Workers Builds (automatic deploys from GitHub)
1. Make `github.com/isaacgyampoh/betting` **private**, then push `main`.
2. Cloudflare dashboard → **Workers & Pages → gameclaw → Settings → Builds → Connect** → pick the repo. Production branch: `main`.
3. **Build command:** `pnpm cf:build:ci`. **Deploy command:** `pnpm exec opennextjs-cloudflare deploy`.
4. **Build variables:**
   - `DIRECT_URL`: Supabase session pooler, port 5432, for migrations; mark it as a secret.
   - `ENABLE_EXPERIMENTAL_COREPACK`: `1`
5. Runtime secrets are the ones in the table above; builds reuse the Worker's secrets.

Every push to `main` then migrates, builds and deploys. Other branches get preview builds without migrating.

### Hyperdrive (recommended)
Without it, every request opens a new TLS connection to Ireland. With it, pooled connections sit next to the database.
```bash
npx wrangler hyperdrive create gameclaw-db \
  --connection-string="postgresql://postgres.qefedcphkmxuxjetmtqw:<PASSWORD>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
```
Add the returned id to `wrangler.jsonc` as `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }]`, run `pnpm cf:typegen`, then deploy. `lib/db.ts` picks it up automatically.

## Domain: gameclaw.win

The Worker owns `gameclaw.win` and `www.gameclaw.win` as **Custom Domains** (`routes` in `wrangler.jsonc`). Cloudflare creates the DNS records and certificates. `www` redirects to the apex in `worker.ts`.

**Cutover from Vercel (one time):**
1. In Cloudflare DNS, delete the Vercel records: `A gameclaw.win 76.76.21.21` and `CNAME www cname.vercel-dns.com`.
2. Run `pnpm cf:deploy`, or trigger Workers Builds. This attaches both custom domains.
3. Check `https://gameclaw.win/api/v1/health` returns `ok`, then remove the domains from the Vercel project and delete it.

**Recommended Cloudflare security settings** (traffic is proxied through Cloudflare now, so these apply):
- **SSL/TLS:** set to Full (strict), and turn on **Always Use HTTPS**.
- **Security → WAF → Rate limiting rules:**
  - When: URI Path starts with `/api/v1/` **and** URI Path does not start with `/api/v1/webhooks/`
  - Limit: 60 requests per 1 minute, counted per IP
  - Action: Block for 1 minute
- **Security → Bots:** turn on **Bot Fight Mode**. It can't exempt paths, so add a WAF custom rule:
  - When: URI Path equals `/api/v1/webhooks/paystack`
  - Action: **Skip** (remaining custom rules, rate limiting, Bot Fight Mode)
  - Paystack's own server calls then always get through. They're verified by HMAC signature in the app anyway.

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
