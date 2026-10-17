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

## 6. Google and Firebase

Checked 2026-10-17. Three credentials, and two of them are not secrets at all — which matters,
because treating a public identifier as a leak wastes a rotation, and treating a real key as
public does the opposite.

| | What it is | Secret? | Where it lives |
|---|---|---|---|
| Web OAuth client ID | `400646694915-…apps.googleusercontent.com` | **No** | passed to the build as `GC_GOOGLE_SERVER_CLIENT_ID`, and shipped inside every APK |
| Firebase Android API key | the `AIzaSy…` in `google-services.json` | **No** | `gameclaw_app/android/app/google-services.json` |
| FCM service account | a JSON file with a PEM private key | **Yes, badly** | Worker secret `FCM_SERVICE_ACCOUNT` |

**The first two cannot be kept secret and are not meant to be.** Both ship inside the APK, where
anyone can read them with `unzip`. Google's own documentation says so of the API key. What
protects them is not obscurity: the Android API key is restricted to callers matching the package
name and signing fingerprint, and the OAuth client ID is only useful to something Google already
believes is GameClaw. Rotating either because it "appeared somewhere" accomplishes nothing and
breaks every installed copy. What *does* matter is that the restrictions are actually in place —
Google Cloud Console → *APIs & Services* → *Credentials* → the Android key → **Application
restrictions: Android apps**, listing `win.gameclaw.app` with each signing fingerprint.

**The OAuth client *secret* is a different thing** and is never needed here: the app uses the
native ID-token flow, which has no secret. If one was ever issued and exposed, reset it in the
console. Nothing in this repository wants it and nothing should ask for it.

**The service account is the one that is genuinely dangerous.** It can send a notification to
every device on the project. If the JSON file was ever committed, emailed, pasted or screenshotted:

1. Firebase → *Project settings* → *Service accounts* → *Manage service account permissions*,
   which opens Google Cloud IAM.
2. Find the key under that service account and **delete it there**. Deleting the downloaded file
   does nothing; the key stays valid until it is revoked in the console.
3. Generate a new private key and set it: `npx wrangler secret put FCM_SERVICE_ACCOUNT
   --config wrangler.api.jsonc < ~/Downloads/<file>.json`

### Status as checked

- `google-services.json` **has never been committed** — not in the working tree, not anywhere in
  history. `git log --all -S AIzaSy` finds nothing. It is covered by
  `gameclaw_app/android/.gitignore`.
- No service-account private key has ever been committed either.
- **`FCM_SERVICE_ACCOUNT` is not set on the Worker.** `wrangler secret list` returns six secrets
  and that is not among them, so the server cannot send a push at all today. Step 4 of
  `docs/notifications.md` is the outstanding one.
- Whether anything was exposed *outside* this repository — a chat, a screenshot, a ticket — is
  not something a coding session can see. If it was, it still needs revoking in the console.

---

## After any rotation

```bash
SERVICE_KEY=... node scripts/smoke-live.mjs
```

That signs up a throwaway account, confirms 18+, walks every tab and deletes the account. It is the
only check here that exercises auth, the database and the browser together — the test suites cannot
see any of them.
