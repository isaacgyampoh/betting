# Rotating the secrets

Every credential gameclaw holds, where it lives, and the order to replace it in without taking the
site down. Work top to bottom: the ones that can be swapped with no coordination come first, and the
database password — the only one that has to change in four places at once — comes last.

Nothing here can be done from a coding session: these live in your Cloudflare, Supabase, Paystack
and Anthropic accounts, behind your logins.

**Before you start.** A credential that has been pasted into a chat, a screenshot, a commit or a
support ticket is a credential someone else may hold. Rotating is the only fix; deleting the message
is not.

```bash
# What the Worker currently holds (names only, never values)
npx wrangler secret list
```

---

## 1. The easy ones — swap any time

Each of these is read by the Worker alone. Create the new value, put it in, deploy. The old one stops
working the moment you revoke it at the provider, so revoke *after* the deploy is live.

| Secret | Where it comes from | Revoke the old one at |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys → Create key | the same page |
| `API_FOOTBALL_KEY` | dashboard.api-football.com → Account | the same page |
| `PAYSTACK_SECRET_KEY` | Paystack → Settings → API Keys & Webhooks → Generate new | the same page |

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put API_FOOTBALL_KEY
npx wrangler secret put PAYSTACK_SECRET_KEY
```

Then check it is live before revoking the old key:

```bash
curl -s https://gameclaw.win/api/v1/health | python3 -m json.tool   # status ok
```

**Paystack also has a public key**, `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` in `wrangler.jsonc` → `vars`.
It is public by design, but it is regenerated alongside the secret key, so change it in the same
commit and deploy — checkout breaks if the pair does not match.

## 2. The ones you generate yourself

```bash
npx wrangler secret put IP_HASH_SALT    # openssl rand -hex 32
npx wrangler secret put CRON_SECRET     # openssl rand -hex 32
```

`IP_HASH_SALT` only salts hashed IPs for anonymous rate limiting; changing it resets those counters
and nothing else. `CRON_SECRET` must also be updated wherever the cron is triggered from.

**Push keys** (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) are a pair,
and rotating them silently invalidates every existing push subscription — everyone who turned on
pick alerts stops receiving them with no error anywhere. Only rotate these if the private key is
actually exposed, and clear `push_subscriptions` when you do, so people are asked again:

```bash
npx web-push generate-vapid-keys
```

## 3. Cloudflare

The deploy token lives in GitHub, not in the Worker.

1. Cloudflare → My Profile → API Tokens → create a new token with exactly: **Workers Scripts edit,
   Workers Routes edit, Hyperdrive read, Tail read, Account read, User read**. Not the Global API
   Key — if the Global API Key was ever exposed, roll it on that page and stop using it anywhere.
2. GitHub → repo → Settings → Secrets and variables → Actions → update `CLOUDFLARE_API_TOKEN`.
3. Push any commit and watch the deploy. The smoke test waits for its own commit sha, so a broken
   token fails the run rather than quietly leaving the old build up.
4. Delete the old token.

`CLOUDFLARE_ACCOUNT_ID` is an identifier, not a secret.

## 4. Supabase

Three different things, often confused:

- **anon key** — public by design, shipped to the browser, in `wrangler.jsonc` → `vars`. Rotating it
  means redeploying the site. Harmless to expose.
- **service_role key** — full access to every row, bypassing RLS. This one matters. It is used by
  `scripts/smoke-live.mjs` and by nothing in the deployed app, so it should exist only in your local
  `.env.local` as `SERVICE_KEY`.
- **personal access token** — your account, not the project.

Supabase → Project Settings → API → *Rotate* the keys there, then:

```bash
# local only; the Worker does not hold the service-role key
$EDITOR .env.local            # SERVICE_KEY=...
```

If the anon key changed, update `wrangler.jsonc` → `vars` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, commit
and deploy. **Rotating the JWT secret signs every user out**, so do that only if it was exposed.

## 5. The database password — last, and all at once

The password appears in four places and they must agree, or the site loses its database.

1. Supabase → Project Settings → Database → Reset database password. Copy it once.
2. Build both URLs from it:
   - `DIRECT_URL` — session pooler, port **5432** (migrations)
   - `DATABASE_URL` — transaction pooler, port **6543** (fallback when Hyperdrive is unbound)
3. Update, in this order:

```bash
# a) Hyperdrive, which is what the Worker actually connects through
npx wrangler hyperdrive update 673d415bb1174f8092e5649a5675516a \
  --connection-string="postgresql://postgres.<ref>:<NEW>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"

# b) the Worker's fallback
npx wrangler secret put DATABASE_URL

# c) your machine
$EDITOR .env.local            # DATABASE_URL and DIRECT_URL
```

   d) GitHub → Actions secrets → `DIRECT_URL`, which migrations run against.

4. Check, in this order:

```bash
curl -s https://gameclaw.win/api/v1/health | python3 -m json.tool          # not "database_unreachable"
SERVICE_KEY=... node scripts/smoke-live.mjs                                # a real user, every tab
```

If health says `database_unreachable`, Hyperdrive has the old password: fix (a) and wait a minute.

---

## After any rotation

```bash
SERVICE_KEY=... node scripts/smoke-live.mjs
```

That signs up a throwaway account, confirms 18+, walks every tab and deletes the account. It is the
only check here that exercises auth, the database and the browser together — the test suites cannot
see any of them.
