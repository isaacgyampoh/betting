# Deploying gameclaw (Vercel + Supabase)

About 45 minutes the first time. Do the steps in order: each one produces values the next one needs.

## 1. Supabase

Your project (`qefedcphkmxuxjetmtqw`) is in **eu-west-1 (Ireland)**, so the Vercel functions are pinned to `dub1` (Dublin) in `vercel.json`. Keeping them close avoids adding ~100 ms to every database query.

1. **Database password.** Go to Project Settings → Database → *Reset database password*. Store it in your password manager.
2. **Connection strings.** Click **Connect**, then **ORMs → Prisma**. Copy both:
   - `DATABASE_URL`: the **Transaction pooler** string (port **6543**). The app uses it at runtime.
   - `DIRECT_URL`: the **Session pooler** string (port **5432**). Only migrations use it.
3. **Run the migrations and seed from your machine.** Put both URLs in `.env.local`, then:
   ```bash
   pnpm db:migrate    # 4 migrations: schema, RLS + auth trigger, 2 small alters
   pnpm db:seed       # plans (GHS prices) + bookmakers
   ```
   Check in Table Editor that `plans` has 3 rows. Every table should show **RLS enabled**.
4. **Auth URLs.** Under Authentication → URL Configuration:
   - Site URL: `https://YOUR-DOMAIN`
   - Redirect URLs: `https://YOUR-DOMAIN/auth/callback`, `http://localhost:3000/auth/callback`, and `https://*-YOUR-VERCEL-TEAM.vercel.app/auth/callback` (for preview deploys)
5. **Email (important).** Supabase's built-in email sender is heavily rate-limited, to just a few emails an hour, so it isn't usable in production.
   - Under Authentication → SMTP Settings, add a real provider (Resend, Postmark, Brevo, etc.).
   - Edit the *Magic Link* email template to use your branding.
6. **Google sign-in.**
   1. In Google Cloud Console, go to APIs & Services → Credentials → *Create OAuth client ID* (Web application).
   2. Set the authorized redirect URI to `https://qefedcphkmxuxjetmtqw.supabase.co/auth/v1/callback`.
   3. Paste the client ID and secret into Supabase under Authentication → Providers → Google.
   4. Publish the OAuth consent screen, or only test users can sign in.
7. **Backups.** Daily backups need the Supabase Pro plan. Upgrade before real users pay.

## 2. Third-party keys

| Service | Where | Notes |
|---|---|---|
| Anthropic | console.anthropic.com → API keys | Set a **monthly spend limit** in the console. Chat runs on Claude Haiku 4.5; deep analysis on Claude Opus 5.5 (per-match cached 3 h). |
| API-Football | dashboard.api-football.com | Free plan: 100 requests/day. The Postgres cache absorbs most traffic; upgrade when `stats.api_error` shows quota errors. Without a key, stats run on clearly labelled sample data. |
| Paystack | dashboard.paystack.com → Settings → API Keys & Webhooks | Start with **test** keys. Webhook URL: `https://YOUR-DOMAIN/api/v1/webhooks/paystack`. Live keys need a verified Ghana business. |

## 3. Vercel

1. Import the Git repo at vercel.com → *Add New → Project*. The framework preset should be **Next.js**.
2. Add the environment variables below for Production (and Preview, pointing at test keys).

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://YOUR-DOMAIN` |
   | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → API |
   | `DATABASE_URL` | Transaction pooler string (6543) |
   | `DIRECT_URL` | Session pooler string (5432). Not used at runtime, but harmless |
   | `IP_HASH_SALT`, `CRON_SECRET` | `openssl rand -hex 32` each |
   | `ANTHROPIC_API_KEY` | … |
   | `API_FOOTBALL_KEY` | … (optional) |
   | `PAYSTACK_SECRET_KEY` | `sk_test_…` first, `sk_live_…` later |
   | `SPORTYBET_MODE`, `BETWAY_MODE` | `mock` until the live adapters exist |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the pnpm version pinned in `package.json` |

3. Deploy. The `postinstall` script runs `prisma generate`, so no extra build step is needed.
4. Add your domain under Settings → Domains, then update `NEXT_PUBLIC_SITE_URL` and the Supabase URLs from step 1.4.
5. Crons: `vercel.json` schedules `/api/v1/cron/cleanup` daily at 03:30 GMT. Vercel sends the `CRON_SECRET` automatically.

> **Future migrations:** run `pnpm db:migrate` against production (with `DIRECT_URL` set) **before** deploying code that needs the new schema. Migrations are additive by convention, so old code keeps working in between.

## 4. After the first deploy

Check each of these once:

1. `GET /api/v1/health` returns `{"data":{"status":"ok"}}`.
2. Sign in with a magic link. The email should arrive within seconds, and you should land on the 18+ step and then `/slip`.
3. Load `BC7K2Q` (SportyBet mock), convert it to Betway, and trim it to 5.0. Each step should give you a new code.
4. `/matches` shows fixtures, and the "Sample data" banner is gone if you set an API-Football key.
5. `/chat`: *"Convert SportyBet BC7K2Q to Betway and remove anything above 2.0"*. You should get a reply with a Betway code, and 4 free requests left.
6. Buy the Day Pass with a Paystack **test** card or test MoMo number.
   - The callback page should say *You're all set*.
   - In Paystack → Webhooks, the delivery shows 200.
   - `/account` lists the payment.
7. Install as an app: on Android Chrome use *Add to Home screen*; on iOS Safari use *Share → Add to Home Screen*.
8. Run the RLS spot check. It should return `[]`:
   ```bash
   curl "https://qefedcphkmxuxjetmtqw.supabase.co/rest/v1/profiles" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
   ```

## 5. Operating it

- **Logs.** Vercel → Logs. Every line is JSON with a `msg` field. Useful searches:
  - `bookmaker.unmapped_market`: markets the adapters don't know yet
  - `api.unhandled`: bugs
  - `paystack.`: payments
  - `ai.`: the assistant
- **Costs.** `usage_logs` records tokens and `cost_micro_usd` for every AI request. Spend per day:
  ```sql
  select date_trunc('day', created_at) d, sum(cost_micro_usd)/1e6 usd from usage_logs group by 1 order by 1 desc;
  ```
- **Prices and limits.** Edit the `plans` table. No deploy is needed.
- **Going live with a bookmaker.** Follow `docs/capturing-bookmaker-requests.md`, implement the live branch in `lib/bookmakers/<name>.ts`, run the tests, then set `<NAME>_MODE=live` for that bookmaker only.
