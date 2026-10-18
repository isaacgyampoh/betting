# Deploying the catalogue work, and getting back

Everything described here is **unshipped**. The `render` branch is ahead of what production runs,
`autoDeploy` is off, and no deploy has been triggered. This file exists so that deploying is a
decision with a known rollback rather than a sequence to improvise.

## What production is running now

| | |
|---|---|
| Service | `srv-db9nfr4s728c73cbbjvg` (Render, Frankfurt) |
| Live deploy | commit `073be1f7`, 17 Oct 2026 21:38 UTC |
| `autoDeploy` | **off** — pushing to `render` changes nothing by itself |
| Branch ahead by | the catalogue, the share feature, the billing guard, the R8 fix |

## What a deploy would change

**Additive, no migration, no schema change.** Nothing in this work alters the database, and no
Prisma migration is pending from it.

1. `GET /v1/bookmakers/catalogue` — a new, open, read-only endpoint. Nothing calls it yet; the
   Flutter app does not know it exists.
2. `POST /v1/billing/checkout` — returns **503** instead of a bare 500 when `PAYSTACK_SECRET_KEY`
   is absent, and no longer writes a `PENDING` payment row it could never charge.
3. `POST /v1/webhooks/paystack` — returns **503** instead of 500 while unconfigured, *before*
   attempting a signature check it has no key for.
4. `lib/bookmakers/providers/*` — present but **inert**: `configured` is false without
   `CONVAT_API_KEY`, and nothing in the request path calls it.

`GET /v1/bookmakers`, which the convert screen depends on, is **unchanged**. That was verified
locally against the running service after the catalogue was added.

### The one behaviour change worth thinking about

The Paystack webhook moving from 500 to 503 changes nothing for Paystack — it retries on both. It
changes what our logs say, from "we crashed" to "payments are not configured here", which is the
truth. If you would rather the webhook kept failing loudly as a 500 until the key is added, say so;
it is a one-line revert.

## Order of operations

Payments are the only part where order matters.

1. **Add `PAYSTACK_SECRET_KEY`** to the Render service first, if payments are meant to work. With
   it present, checkout and the webhook simply work; without it they now fail honestly instead of
   crashing. Either is a valid end state — deploying without the key is still an improvement.
2. **Deploy** from the Render dashboard, or by triggering a deploy for commit `c7a0100` or later.
   There is no migration step.
3. **Verify**, in this order:
   ```bash
   # The endpoint that must not have changed.
   curl -s https://gameclaw-api.onrender.com/api/v1/bookmakers \
     | python3 -c "import sys,json; [print(b['slug'], b['canLoad'], b['canBook'], b['status']) for b in json.load(sys.stdin)['data']]"
   # Expect sportybet and footballcom: true true available. Anything else is a stop.

   # The new endpoint.
   curl -s https://gameclaw-api.onrender.com/api/v1/bookmakers/catalogue \
     | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['coverage'])"
   # Expect directions: 2. If it says more, the catalogue is overclaiming.

   # Payments report themselves honestly.
   curl -s https://gameclaw-api.onrender.com/api/v1/health \
     | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['features'])"

   # The cron secret still works.
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer $(cat ~/.gameclaw-cron-secret)" \
     https://gameclaw-api.onrender.com/api/v1/cron/match-alerts
   # Expect 200.
   ```

### The stop conditions

Roll back immediately if any of these is true after deploying:

- `/v1/bookmakers` no longer reports SportyBet and Football.com as `available` with `canBook: true`.
- `/v1/bookmakers/catalogue` reports more than **2** directions.
- The cron endpoint stops returning 200 for the correct secret.
- Any bookmaker is offered as a destination that was not offered before.

## Rollback

**Render keeps previous deploys and can roll back to one directly** — this is the first resort,
takes effect in minutes, and needs no git operation:

> Render dashboard → the service → **Deploys** → the entry for `073be1f7` → **Rollback to this
> deploy**.

That restores the exact image running now. Because this work adds no migration and changes no
schema, a rollback is clean: there is no data written in the new version that the old one cannot
read.

If a code-level revert is wanted instead:

```bash
git revert --no-commit c7a0100   # the catalogue
git commit -m "Revert the operator catalogue"
git push origin render
# then deploy from the dashboard as above
```

Reverting the catalogue alone is safe — nothing else depends on it. Reverting the billing commit
restores the previous 500s, which is worse, so revert it only if it is the specific cause.

### What rollback does not undo

Nothing, in this case — but worth stating so it is not assumed in future. No migration ran, no
production data was written, no secret was rotated, and no third-party account was created. The
only persistent effects of this work are in version control.

## Still requiring a decision

| Decision | Why it cannot be made here |
|---|---|
| Add `PAYSTACK_SECRET_KEY` | The key is not ours to hold |
| Trigger the deploy | Production change |
| Create a Betloy account | An account in the owner's name |
| Sign Convat's evaluation agreement | A contract |
| Create the Play upload keystore | A signing credential |
| Set the cron schedule | No access to cron-job.org |
