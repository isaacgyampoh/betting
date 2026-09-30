# Deploying gameclaw (Vercel + Supabase)

**Live:** https://gameclaw-smoky.vercel.app. This is Vercel project `gameclaw` in team *isaac's projects*, running in region `dub1` (Dublin), next to the Supabase database in eu-west-1 (Ireland).

## What's already configured

| Piece | How it works |
|---|---|
| Build | `vercel.json` → install `pnpm install --frozen-lockfile`, build `pnpm run vercel-build` (= `prisma generate` → migrations → `next build`) |
| pnpm / Node | `packageManager: pnpm@12.3.4` via Corepack (`ENABLE_EXPERIMENTAL_COREPACK=1`); Node `24.x` via `engines` |
| Migrations | `scripts/migrate-on-deploy.mjs` runs `prisma migrate deploy` with `DIRECT_URL` on **production** deploys only. Preview deploys never touch the DB, and `migrate dev` is never used. If `DIRECT_URL` is missing, it warns and skips. |
| Cron | `/api/v1/cron/cleanup` runs daily at 03:30 GMT, protected by `CRON_SECRET` (Vercel sends it automatically) |
| Local uploads | `.vercelignore` keeps `.env*` and local-only folders out of `vercel deploy` uploads |

## Environment variables (Vercel → Project → Settings → Environment Variables)

✅ = already set on Production. ⬜ = you still need to add it.

| Variable | Scope | Status | Value / where from |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | ✅ | `https://gameclaw-smoky.vercel.app`. Change it when you add a custom domain. |
| `NEXT_PUBLIC_SUPABASE_URL` | public | ✅ | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | ✅ | Supabase → Project Settings → API (anon key; RLS protects data) |
| `IP_HASH_SALT` | server | ✅ | Generated for production |
| `CRON_SECRET` | server | ✅ | Generated for production |
| `SPORTYBET_MODE`, `BETWAY_MODE` | server | ✅ | `mock` (until live adapters are built) |
| `STATS_MODE` | server | ✅ | `auto` |
| `ENABLE_EXPERIMENTAL_COREPACK` | build | ✅ | `1` |
| `DATABASE_URL` | server | ⬜ | Supabase → **Connect → ORMs → Prisma** → Transaction pooler (port **6543**) |
| `DIRECT_URL` | server | ⬜ | Same screen → Session pooler (port **5432**). Used for migrations on deploy. |
| `ANTHROPIC_API_KEY` | server | ⬜ | console.anthropic.com → API Keys. Set a monthly spend limit there too. |
| `PAYSTACK_SECRET_KEY` | server | ⬜ | Paystack → Settings → API Keys & Webhooks (`sk_test_…` first) |
| `API_FOOTBALL_KEY` | server | ⬜ optional | dashboard.api-football.com. Without it, stats use labelled sample data. |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | public | optional | Not needed today (hosted checkout) |

Never add the Supabase **service_role** key; the app doesn't use it. Every non-`NEXT_PUBLIC_` value above must stay server-only.

Add variables from the dashboard (tick **Production** and **Preview**; for Preview use test keys), or from the CLI:
```bash
vercel env add DATABASE_URL production      # paste the value when prompted
```
Any env change needs a redeploy: `vercel deploy --prod`, or Deployments → ⋯ → Redeploy.

## Step 1: Database password and migrations

1. Supabase → Project Settings → Database → **Reset database password**. Save it in a password manager.
2. Supabase → **Connect → ORMs → Prisma**. Copy the two connection strings and put the password in both.
   - If the password has special characters, URL-encode them (`@` → `%40`, `#` → `%23`).
3. Paste both into your local `.env.local` (`DATABASE_URL`, `DIRECT_URL`) and into Vercel (table above).
4. From your machine:
   ```bash
   pnpm db:migrate && pnpm db:seed
   ```
   Future production deploys apply new migrations automatically.

## Step 2: Supabase Auth URLs

Supabase → Authentication → **URL Configuration**:

- **Site URL:** `https://gameclaw-smoky.vercel.app`
- **Redirect URLs** (add all four):
  - `https://gameclaw-smoky.vercel.app/auth/callback`
  - `https://gameclaw-*-isaacs-projects-7cdab31a.vercel.app/auth/callback` (preview deploys)
  - `http://localhost:3000/auth/callback`
  - your custom domain's `/auth/callback`, when you have one

Then under Authentication → **SMTP Settings**, add a real email provider (Resend, Postmark, Brevo…). The built-in sender only allows a few magic-link emails an hour.

## Step 3: Google sign-in (optional)

1. Google Cloud Console → APIs & Services → **Credentials → Create credentials → OAuth client ID** → *Web application*.
2. **Authorized JavaScript origins:** `https://gameclaw-smoky.vercel.app`
3. **Authorized redirect URIs:** `https://qefedcphkmxuxjetmtqw.supabase.co/auth/v1/callback`. This is the *Supabase* callback, not the app's.
4. Copy the client ID and secret into Supabase → Authentication → **Providers → Google** → Enable → Save.
5. OAuth consent screen → **Publish app**. Until you do, only listed test users can sign in.

## Step 4: Paystack (test mode first)

1. Paystack dashboard → switch to **Test Mode** (toggle, top right).
2. Settings → **API Keys & Webhooks**:
   - Copy the **Test Secret Key** into Vercel as `PAYSTACK_SECRET_KEY`.
   - **Test Webhook URL:** `https://gameclaw-smoky.vercel.app/api/v1/webhooks/paystack` → Save.
   - **Test Callback URL:** leave empty. The app sends its own (`/billing/callback`).
3. Redeploy, then buy the Day Pass using Paystack's test card or test mobile money number (shown on the checkout page in test mode).
4. **Going live:** verify your business in Paystack, switch to Live Mode, and set the **Live Webhook URL** to the same address. Put the `sk_live_…` key in Vercel (Production only; keep Preview on test), then redeploy.

## Step 5: GitHub and automatic deploys

The deploys so far were made from this machine with `vercel deploy --prod`. To deploy on every push:

1. **Make the repo private first.** `github.com/isaacgyampoh/betting` is currently **public**. Go to GitHub → the repo → Settings → General → Danger Zone → **Change visibility → Private**.
2. Push:
   ```bash
   git push -u origin main
   ```
3. Vercel → Project `gameclaw` → Settings → **Git** → Connect Git Repository → pick `isaacgyampoh/betting`. Production branch: `main`.

Every push to `main` then deploys to production (running migrations). Pull requests get preview URLs, and those never migrate. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, integration tests (against a throwaway Postgres) and a build on each push.

## Step 6: Post-deploy checklist

Run through this after steps 1–4:

- [ ] `https://gameclaw-smoky.vercel.app/api/v1/health` returns `{"data":{"status":"ok",…}}`
- [ ] **Sign in by magic link.** The email arrives within a minute, and the link lands you on **/welcome**.
- [ ] **/welcome:** tick both boxes, press Continue, and you land where you were going. `/account` shows the Free plan and 5 AI requests.
- [ ] **Load a mock slip:** on `/slip`, SportyBet + `BC7K2Q` shows 8 games and total odds.
- [ ] **Convert:** press Convert, choose Betway. You get a new `BW…` code, 7 games carried over, and *Nations FC* listed as not found.
- [ ] **Edit:** Edit → Trim odds → 5 gives a new code with total ≤ 5.
- [ ] **AI chat** (needs `ANTHROPIC_API_KEY`): *"Convert SportyBet BC7K2Q to Betway and remove anything above 2.0"*. The reply includes a Betway code and the counter shows 4 left.
- [ ] **Paystack test payment:** `/pricing` → Get Day Pass → pay with the test card or MoMo. You should see *You're all set*, Paystack → Webhooks shows a 200 delivery, and `/account` lists the payment.
- [ ] **Install as an app on your phone:**
  - Android: open the site in Chrome → ⋮ → *Add to Home screen* / *Install app*.
  - iPhone: open it in Safari → Share → *Add to Home Screen*.
  - It should open full-screen with the green claw icon.
- [ ] **RLS spot check.** This should return `[]`:
  ```bash
  curl "https://qefedcphkmxuxjetmtqw.supabase.co/rest/v1/profiles" -H "apikey: <anon key>"
  ```

## Operating it

- **Logs:** Vercel → Logs. Lines are JSON. Search on `msg`:
  - `api.unhandled`: bugs
  - `bookmaker.unmapped_market`: markets the adapters don't know yet
  - `paystack.`: payments
  - `ai.`: the assistant
  - `[migrate]`: migrations (these appear in the **build** logs)
- **AI spend per day:**
  ```sql
  select date_trunc('day', created_at) d, sum(cost_micro_usd)/1e6 usd from usage_logs group by 1 order by 1 desc;
  ```
- **Prices and limits:** edit the `plans` table. No deploy is needed.
- **Custom domain:** Vercel → Settings → Domains. Then update `NEXT_PUBLIC_SITE_URL`, the Supabase URLs (step 2), Google origins (step 3) and the Paystack webhook (step 4), and redeploy.
- **Live bookmakers:** follow `docs/capturing-bookmaker-requests.md`, implement the live branch in `lib/bookmakers/<name>.ts`, then set `<NAME>_MODE=live`.
