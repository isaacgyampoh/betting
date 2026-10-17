# Retiring Supabase

Written 2026-10-17 against the running system. **Nothing here has been deleted and nothing should
be until every box is ticked and you say so.**

The short version: the *database* has already moved and is no longer used by the Render service.
What still reaches Supabase is **authentication**, and it reaches it from two places for two
different reasons.

---

## What still depends on Supabase, today

### 1. Token verification — the only one that matters

`lib/auth.ts` accepts two kinds of bearer token, in this order:

1. **GameClaw's own**, verified locally with `AUTH_JWT_SECRET`. No network call.
2. **Supabase's**, as a fallback, via `supabase.auth.getClaims()`.

The fallback exists so that a session issued before the cutover keeps working instead of signing
everyone out the moment the new API deployed. It is the last real runtime dependency.

**It cannot be removed yet**, because the Flutter app still obtains its tokens from Supabase —
see §3.

### 2. Two environment variables, and a settings probe

| | Why it is still there |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required by `lib/env.ts`, used by the fallback above |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `lib/auth-providers.ts` | asks Supabase which providers are enabled, for the **website's** login form |

`auth-providers.ts` serves `gameclaw.win`, which is staying on Cloudflare and Supabase for now.
It is not used by the mobile API.

### 3. The Flutter app still signs in through Supabase

`gameclaw_app/lib/data/auth_client.dart` posts to five Supabase endpoints. The replacements exist
and are deployed — `/auth/google`, `/auth/refresh`, `/auth/logout` — but the app has not been
switched over, for one specific reason:

> The new API has **no password endpoint**, by design. Switching the app today removes
> email/password sign-in, and the standing rule is that it stays until Google sign-in has
> genuinely succeeded on the device. It has not. See §A below.

### 4. Not dependencies, despite appearances

Checked and empty: Storage, Realtime, Vault, Edge Functions, PostgREST. The `auth` schema is used
only as a source for the identity backfill, which has already run. Scheduled jobs are Cloudflare
crons, not Supabase.

---

## The checklist

Nothing here is reversible once the last step runs, so the order matters.

### A. Before anything can proceed

- [ ] **Android OAuth client created** for `win.gameclaw.app` with the debug SHA-1, and the
      release/Play App Signing fingerprints when those exist. This is the only blocker, and it
      blocks everything below it. Diagnosis in `docs/release-signing.md` §5.
- [ ] **A genuine Google sign-in succeeds on the Pixel** — the account chooser completes and the
      app shows a signed-in profile. Not "the chooser appeared".

### B. Move the app onto the new backend

- [ ] Point `auth_client.dart` at `/auth/google`, `/auth/refresh`, `/auth/logout`, unwrapping the
      `{"data": …}` envelope the API returns.
- [ ] Point `GC_API_BASE` at the Render service.
- [ ] Rebuild and verify on the device: sign in, kill the app, relaunch, still signed in
      (refresh works), sign out, sign in as a different account.
- [ ] Verify a protected call — Claw, or a slip conversion — succeeds with the new token.
- [ ] Verify public browsing still works signed out.

### C. Prove nothing else is on Supabase

- [ ] No Supabase-issued token has been accepted for longer than its lifetime. Supabase access
      tokens are short-lived, so a day after the app stops asking for them is conclusive.
- [ ] Remove the Supabase fallback branch from `lib/auth.ts`.
- [ ] Remove `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Render
      service and from `lib/env.ts`.
- [ ] Decide what happens to `gameclaw.win`'s own login, which is a separate system on Cloudflare
      and the last thing using `lib/auth-providers.ts`. Retiring Supabase means retiring that
      login too, or moving it.
- [ ] `grep -rn supabase lib/ app/` returns nothing that runs.

### D. Data and safety

- [ ] A fresh verified backup of Supabase, taken after the final writes.
      The last one is `~/gameclaw-backups/20261017-114921/gameclaw-full.dump`, verified by
      restoring it and matching every row count.
- [ ] A **delta check**: anything written to Supabase after that backup, copied to Render. On
      2026-10-17 this was 4 `usage_logs` rows and 6 `stats_cache` rows, both unimportant — but it
      will not be zero, because Supabase is still serving.
- [ ] Render backups confirmed in the dashboard. Render's API has no backups endpoint on this
      plan, so this is a thing to look at rather than something that can be asserted here.

### E. Only then

- [ ] You explicitly approve retirement.
- [ ] Pause the Supabase project rather than deleting it. A paused project can be restored; a
      deleted one cannot.
- [ ] Leave it paused for a period you are comfortable with before deleting.

---

## What is already done

| | |
|---|---|
| Database migrated | 19/21 tables identical, md5 content checks match on every table that matters |
| Identities carried across | 7 Google identities, 12 of 13 last-sign-in times |
| Render database private | allow list empty; reachable only over Render's private network |
| New auth deployed | `/auth/google`, `/auth/refresh`, `/auth/logout` live and refusing bad input |
| Admin dashboard | live at `https://admin.gameclaw.win/admin`, anonymous access refused |
| Rollback | nothing is cut over; the app still uses Cloudflare + Supabase, both untouched |
