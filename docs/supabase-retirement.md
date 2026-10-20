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

### A. Before anything can proceed — **done 2026-10-17**

- [x] **Android OAuth client created** for `win.gameclaw.app` with the debug SHA-1. The release
      and Play App Signing fingerprints still need their own clients before shipping; see
      `docs/release-signing.md` §5.
- [x] **Web OAuth client recreated.** The old one had been *deleted*, which is what every
      confusing error downstream was really about.
- [x] **A genuine Google sign-in succeeded on the Pixel**, against
      `https://gameclaw-api.onrender.com`, with Supabase not involved at all:

      Signed in as nanagyams99@gmail.com
      profile id    29dd0df2-03ec-4c01-9b9e-d237cd16b356   (the one migrated from Supabase)
      role          ADMIN                                   (preserved)
      slips         30                                      (preserved)
      subscriptions 1                                       (preserved)
      identity      google sub=114233277727945877413        (matched, not created)
      profiles      13                                      (unchanged - it LINKED)

      The account was **linked, not recreated**: the profile count stayed at 13 and the existing
      slips, subscription and admin role are all still attached. That is the migration-critical
      behaviour, and it is the thing that would have been silently wrong if matching had fallen
      back to email or created a new row.

- [x] Session survives a relaunch, and Claw - a protected feature - loads without a refusal.

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

---

## 19 Oct — Supabase is already gone, and three things broke with it

The project at `qefedcphkmxuxjetmtqw.supabase.co` no longer answers: `curl` to its REST endpoint
returns no response at all, not a 4xx. Whatever retired it, this document's "nothing has been
deleted" opening is no longer true, and the Cloudflare Worker was never repointed.

The Worker's `DATABASE_URL` still refers to it. Everything below follows from that one secret:

| Symptom | Where |
| --- | --- |
| `{"status":"database_unreachable"}` | `gameclaw.win/api/v1/health` |
| **HTTP 500** on a page linked from the home page three times | `gameclaw.win/track-record` |
| `INTERNAL` error | `gameclaw.win/api/v1/picks` |
| **No daily picks since 2026-10-17** | the `0 7 * * *` trigger |

The picks one is the expensive one and was invisible. `worker.ts`'s `scheduled` handler does not
call the API over the network; it invokes the OpenNext handler in-process, so the job runs inside
the Worker against the Worker's own database. With that database gone the job has failed every
morning since, and the most recent published pick is dated 17 October. Nothing alerts on it — the
handler logs `cron.triggered` with a non-ok status and that is the end of it.

The Render service is unaffected and healthy: it has its own `DATABASE_URL` pointing at
`gameclaw-db`, and it is what the Flutter app talks to. This is why the app looks fine while the
website does not.

### The fix — and the wrong version of it

**Setting the `DATABASE_URL` secret does not work.** That was the first answer here and it was
wrong. `lib/db.ts` picks its connection like this:

```ts
client = createClient(cf.env.HYPERDRIVE?.connectionString ?? env().DATABASE_URL);
```

Hyperdrive wins whenever it is bound, and `wrangler.jsonc` binds it unconditionally. The secret is
only ever read when the binding is absent, so writing a correct value into it would have changed
nothing and looked like the fix had failed for some other reason.

The connection actually in use belongs to the Hyperdrive config, and it still points at the
deleted project:

```
$ wrangler hyperdrive get 673d415bb1174f8092e5649a5675516a
  name:   gameclaw-db
  origin: aws-1-eu-west-1.pooler.supabase.com   user: postgres.qefedcphkmxuxjetmtqw
```

So the repair is to repoint Hyperdrive:

```
wrangler hyperdrive update 673d415bb1174f8092e5649a5675516a \
  --origin-host <host> --origin-port 5432 --database gameclaw \
  --origin-user gameclaw --origin-password <password>
```

Two details that decide whether it works:

- It needs `gameclaw-db`'s **external** connection string, from the Render dashboard. The
  `connectionString` property `render.yaml` wires into the Render service is the *internal* one,
  reachable only from inside Render's network — Cloudflare cannot use it.
- Hyperdrive caches reads for 30 seconds (`caching.max_age`). That is fine for the website's
  pages, and it is worth knowing before anyone debugs a stale-looking `/track-record` right after
  the switch.

That restores `/track-record`, the site's `/api/v1/picks`, and both cron triggers together,
because all three fail for the same reason. Repointing the cron alone would leave the website's
pages broken.

Worth doing at the same time, and not done here: a non-ok `cron.triggered` should page someone.
Two days of a headline feature producing nothing, with the failure written only to a log nobody
reads, is the part of this that should not have needed a person to notice.
