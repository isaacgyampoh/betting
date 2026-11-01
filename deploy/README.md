# GameClaw on a VPS — migration package

Written for whoever operates this server. It assumes you can use SSH and `docker compose`, and
nothing else.

Everything here is **prepared, not applied**. No VPS has been bought, nothing is deployed, Render
is still the source of truth, and the Cloudflare Worker still forwards to
`gameclaw-api.onrender.com`.

---

## 1. What this replaces, and what it does not

| Today | After cutover |
|---|---|
| Render web service `gameclaw-api` (0.5 CPU, 512 MB) | `api` container on the VPS |
| Render Postgres `gameclaw-db` (0.1 CPU, 256 MB) | `db` container, internal network only |
| Public Postgres on port 5432 | No published port at all |
| Migrations from GitHub Actions over the public internet | `docker compose run --rm migrate`, on the host |

**Unchanged:** Cloudflare keeps the domain, DNS and the website Worker. The Flutter apps keep
talking to one HTTPS origin. Google and Apple sign-in, session refresh, account linking, Firebase
push and the two cron triggers all keep working because none of them depends on where the API runs —
only on its URL, which is the single thing the cutover changes.

---

## 2. Audit: what GameClaw actually needs

Measured, on 2026-11-01.

| Thing | Value | How it was established |
|---|---|---|
| Current API compute | **0.5 CPU, 512 MB** | Render plan `starter` = plan id `0.5c-512mb`, from Render's compute-plans doc |
| Current database compute | **0.1 CPU, 256 MB** | Render plan `basic-256mb` = `0.1c-256mb` |
| **Total production compute today** | **0.6 vCPU, 768 MB** | the two above |
| Current cost | **$13/month** | $7 service + $6 database, excluding storage at $0.30/GB |
| Schema | **27 tables, 10 enums, 19 migrations** | `prisma/schema.prisma`, `prisma/migrations` |
| API latency (median) | health 293 ms · picks 516 ms · track-record 991 ms · competitions 1204 ms | 7 warm samples each, `scripts/bench.mjs` output recorded below |
| API latency (p90) | 625 ms – 2250 ms depending on route | same run |
| Largest response | `/api/v1/picks/track-record` 40 KB, `/api/v1/competitions` 33 KB | same run |
| Bookmakers integrated | **2 live** (SportyBet, Football.com — both read and write) of 9 modelled | `/api/v1/health`, `/api/v1/bookmakers` |
| File/upload storage | **none** | no blob store, no disk mount; team and league images are hotlinked from `media.api-sports.io` |
| Background jobs | 2 Cloudflare cron triggers (03:30, 07:00 UTC) calling the API over HTTPS | `wrangler.jsonc`, `worker.ts` |

### Not measured, and why

These need Render dashboard or database credentials, which this preparation did not have. Do not
let anyone turn them into guesses.

- **Database size on disk, row counts, table sizes.** `scripts/migrate-from-render.sh` prints all
  three the first time it runs; the sizing below does not depend on them because the schema has no
  large-object or blob columns.
- **Actual CPU and memory consumption.** Render's metrics are behind the dashboard. The ceiling is
  known (0.5 CPU / 512 MB) and the service is healthy, so real usage is at most that.
- **Peak traffic and concurrent users.** No analytics are wired up. Unknown.
- **Database connection count in use.** `max_connections=100` is configured below, against Prisma's
  `max: 3` per client in `lib/db.ts`.

---

## 3. Sizing

The decisive number is **0.6 vCPU and 768 MB**. That is the whole of production today.

So the question is not whether 4 vCPU / 8 GB is enough — it is roughly 6× the CPU and 10× the
memory of what runs now. The question is what else the box must hold. The allocation in
`docker-compose.yml`:

| Service | CPU ceiling | Memory ceiling |
|---|---|---|
| `api` | 2.0 | 1.5 GB |
| `db` | 1.0 | 1 GB |
| `caddy` | 0.25 | 192 MB |
| **GameClaw total** | **3.25** | **~2.7 GB** |

Ceilings, not reservations: they cap a runaway container rather than reserving the capacity. On a
4 vCPU / 8 GB server that leaves roughly **5 GB and most of two cores** for other projects.

A 2 vCPU / 4 GB server would also run GameClaw comfortably. It is not recommended, because the
stated plan is to consolidate other applications here, and 4 GB does not leave room for a second
Postgres.

---

## 4. Provider comparison

Gathered 2026-11-01 from provider pricing pages and current third-party round-ups. **Confirm every
figure in the checkout basket before paying** — VAT, currency and term rules depend on the billing
country, and two of these providers raised prices during 2026.

| Provider | Plan | CPU | RAM | Storage | Network | Datacenter | Term | Upfront | Renewal | Effective /mo | Backups |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Contabo** | Cloud VPS 4 | 4 | 8 GB | 100 GB SSD | 200 Mbit/s, unmetered (fair use) | EU (Düsseldorf) + 10 others | 24 months | **€105.60** (24 × €4.40) | €5.50/mo | **€4.40** incl. VAT | 1 snapshot; real backups are a paid add-on |
| **OVHcloud** | VPS-2 | 4 | 8 GB | 75 GB **NVMe** | **1 Gbps**, unmetered | EU (Gravelines/Limburg/London) | 12 months | **≈$102** (12 × $8.50) | ~$8.50/mo | **≈$8.50** | **daily backup included**; 7-day rolling +$1.40/mo |
| netcup | VPS Lite 2 | 4 | 8 GB | 160 GB | — | Nuremberg/Vienna | quarterly | ~€24/quarter | €7.98/mo | €7.98 net (+VAT) | extra |
| Hetzner | CPX32 | 4 | 8 GB | 160 GB | 20 TB | Falkenstein | monthly | — | €35.49 excl. VAT | **€35.49** | extra |
| *Render (today)* | starter + basic-256mb | 0.6 | 768 MB | — | — | Frankfurt | monthly | — | $13/mo | **$13** | included (PITR 3–7 days) |

Hetzner is listed because it is the usual recommendation and it is **no longer competitive at this
size**: two 2026 price adjustments took CPX32 to €35.49 before VAT, and CX32 was withdrawn. Checking
that assumption rather than inheriting it is the single most useful thing in this table.

### Recommendation: **OVHcloud VPS-2**, ≈$8.50/month on a 12-month term

Not the cheapest. The reasoning:

- **Postgres is the workload that cares about disk.** OVH gives NVMe; Contabo's Cloud VPS 4 is SATA
  SSD on shared hosts, and inconsistent I/O is Contabo's most frequently reported weakness. The
  database is the one component where a bad day is visible in every request.
- **Backups are included**, and a backup that costs nothing extra is a backup that actually exists.
  With Contabo you get one snapshot and must add a paid backup product, which eats the saving.
- **1 Gbps versus 200 Mbit/s.** Not needed today, but restores and dumps are bandwidth-bound.
- **12 months, not 24.** Half the commitment to a provider nobody here has used before.

Both fit the $15 budget. If the priority is the absolute floor, **Contabo Cloud VPS 4 at €4.40/month
is the cheapest credible option** and saves about $4/month more — accept the I/O variability and add
a backup plan. Either choice beats $13/month on Render while giving several times the capacity.

**Payment from Ghana:** Contabo accepts card, PayPal and bank transfer (no crypto). OVHcloud accepts
Visa/Mastercard/Amex and PayPal, requires 3D Secure, and requires the cardholder name to match the
account. Neither publishes a country-level acceptance list, so **this is the one thing to test
first** — create the account and add the payment method before relying on either. A declined card
can hold funds for up to 15 days at OVH.

---

## 5. First-time setup

```bash
# 1. Harden the host and install Docker. Run from your laptop against a fresh server.
ssh root@<ip> 'bash -s' -- --user gameclaw --pubkey "$(cat ~/.ssh/id_ed25519.pub)" \
  < deploy/scripts/bootstrap-host.sh
# Open a SECOND terminal and confirm `ssh gameclaw@<ip>` works before closing the first.

# 2. On the server
git clone <repo> && cd betting/deploy
cp .env.example .env && ${EDITOR:-nano} .env

# 3. Generate the backup key pair ON YOUR LAPTOP, not on the server
age-keygen -o backup-key.txt          # keep this file off the VPS, in a password manager
#   put the public key (age1...) in BACKUP_AGE_RECIPIENT

# 4. Check, then go
./scripts/preflight.sh
./scripts/deploy.sh
```

`deploy.sh` builds, runs migrations as a one-shot container, starts the stack, waits for the
container healthcheck, then fetches `https://$API_DOMAIN/api/v1/health` through Caddy. If any step
fails it stops, and nothing has been cut over.

**TLS:** the first certificate needs `API_DOMAIN` resolving straight to the server, so set the
Cloudflare record to *DNS only* (grey cloud) initially. The Caddyfile explains the trade-off and the
Cloudflare Origin CA alternative if you want the IP hidden afterwards.

---

## 6. Database migration

Render stays the source of truth until you choose otherwise. Rehearse first, as many times as you
like — the script is read-only against Render and refuses to overwrite the live local database
without `--final`.

```bash
# Rehearsal: copy into a scratch database and compare row counts table by table
RENDER_DATABASE_URL='postgresql://…' ./scripts/migrate-from-render.sh --into gameclaw_import

# Final, during the maintenance window
RENDER_DATABASE_URL='postgresql://…' ./scripts/migrate-from-render.sh --into gameclaw --final
```

It prints the source server version and database size, dumps with `--no-owner --no-acl` (Render's
role names do not exist here), restores, then compares every table's row count against the source
and reports the migration count. A mismatch exits non-zero and says do not cut over.

**This needs Render's public database port, which is the exposure being removed.** Do the migration
*before* closing Render's firewall, or run the dump from a Render shell.

### Preserved

Users, profiles, identities and sessions, matches, picks, settled results, track record, slips,
selections, subscriptions, payments and audit history all travel in the dump — it is the whole
database, not a selection. `AUTH_JWT_SECRET` and `IP_HASH_SALT` must be **carried across from
Render unchanged**: regenerating the first signs every user out, and regenerating the second breaks
every IP-keyed rate-limit record.

---

## 7. Cutover

Nothing in this package performs it. In order:

1. Migrate the database (above) and confirm counts.
2. Point `api.gameclaw.win` at the VPS and confirm `https://api.gameclaw.win/api/v1/health` is `ok`.
3. Change `API_ORIGIN` in `worker.ts` from `https://gameclaw-api.onrender.com` to
   `https://api.gameclaw.win`, and `CRON_TARGET` with it. Deploy the Worker. The forwarder's
   allowlist and the cron target are the only two places the old host is named.
4. Rebuild the Flutter app with `GC_API_BASE` and `GC_AUTH_BASE` pointing at the new origin, and
   release it. **Until that release is installed, every existing phone still calls Render** — so
   Render must keep running until installs have moved over. This is the long pole, not the server.
5. Watch `./scripts/monitor.sh` and the logs for a few days.
6. Only then scale Render down.

Because step 4 takes as long as it takes, plan to pay for both for at least a month.

---

## 8. Backups

```bash
docker compose --profile tools run --rm backup          # manual
```

Nightly, via cron on the host:

```cron
15 3 * * * cd /home/gameclaw/betting/deploy && docker compose --profile tools run --rm backup >> /var/log/gameclaw-backup.log 2>&1
*/5 * * * * /home/gameclaw/betting/deploy/scripts/monitor.sh >> /var/log/gameclaw-monitor.log 2>&1
```

`pg_dump -Fc`, encrypted with **age to a public key**, 7 daily plus 4 weekly retained. The server
holds only the public key, so it can write backups it cannot read — a compromised VPS cannot
decrypt its own history. A row-count manifest is written beside each dump.

**A backup on the same disk as the database is not a backup.** Copy `deploy/backups/` off the box —
`rclone`, `scp` from elsewhere, or the provider's snapshot feature — and verify monthly:

```bash
AGE_KEY_FILE=~/backup-key.txt ./scripts/restore.sh \
  --file backups/gameclaw-<stamp>.dump.age --into gameclaw_verify
```

That restores into a scratch database and compares every table against the manifest. It refuses to
touch the live database without `--force`.

---

## 9. Security

| Control | Where |
|---|---|
| SSH keys only, no root, no passwords, `AllowUsers` | `bootstrap-host.sh` |
| `ufw` default-deny; only 22, 80, 443 | `bootstrap-host.sh` |
| fail2ban on sshd | `bootstrap-host.sh` |
| Unattended **security** updates, no automatic reboot | `bootstrap-host.sh` |
| Postgres unreachable off-host: no published port, `internal: true` network | `docker-compose.yml` |
| Separate owner (DDL) and application (DML only) roles | `postgres/roles.sql` |
| Serving container runs as non-root `nextjs` | `Dockerfile` |
| Per-service CPU and memory ceilings | `docker-compose.yml` |
| Caddy admin API disabled | `Caddyfile` |
| Forged `CF-Connecting-IP` stripped | `Caddyfile` |
| Backups encrypted to a key the server does not hold | `backup.sh` |
| Secrets gitignored, verified by `git check-ignore` | `.gitignore`, `preflight.sh` |

**Read `postgres/roles.sql` before changing which role the application uses.** 25 tables still have
Row Level Security enabled from the Supabase era with 11 policies keyed on `auth.uid()`. A table's
owner bypasses RLS; another role does not — and an RLS-enabled table with no matching policy
returns *zero rows rather than an error*. The application role is therefore granted `BYPASSRLS`, so
it keeps exactly the behaviour it has on Render while losing the DDL rights it never needed.

---

## 10. Hosting other projects later

The pattern, which this stack already follows: **one directory, one compose project, one database
container, one set of credentials, one volume per application.** Caddy is the only shared service.

For a second application:

1. `mkdir ~/shop && cd ~/shop`, its own `docker-compose.yml` with `name: shop`.
2. Its own `db` service, its own volume, its own `internal: true` network. **Never share a Postgres
   container between projects** — one `DROP DATABASE` typo should not be able to reach GameClaw.
3. Its own CPU and memory ceilings.
4. Attach its web container to the shared `gameclaw_edge` network as `external: true`, and add a
   site block to the Caddyfile.
5. Its own backup schedule and its own age key.

### Capacity

On 4 vCPU / 8 GB, with GameClaw capped at 3.25 CPU / 2.7 GB (and idling far below it):

| Additional apps | Realistic? |
|---|---|
| 1 more of this size (app + Postgres, ~1.5 GB) | Comfortable |
| 2 more | Workable; watch memory, keep swap |
| 3 more | Only if they are small or mostly idle |
| An e-commerce app with its own search or queue | Treat as two |

So **three to four applications of GameClaw's size**, not ten. Postgres instances are the limit:
each wants its own `shared_buffers`, and memory is what runs out first. When it does, the move is a
second cheap VPS rather than one large one — isolation is easier to keep that way, and the failure
of one box takes down one set of projects.

---

## 11. Rollback

Nothing is destroyed by deploying this, which is the point. Until step 3 of the cutover, the Worker
and every installed app still call Render. To go back after cutover: revert `API_ORIGIN` in
`worker.ts`, redeploy the Worker, and Render serves again from its own database. Keep Render running
until the new app release has reached your users.

---

## 12. What is not verified

Stated plainly, because the rest of this document is verified.

- **The image has never been built and the stack has never been started.** Docker is not installed
  on the machine this was prepared on. `scripts/validate-config.py` checks the configuration
  statically and passes; `docker compose config` and `docker build` have not run. Expect to fix
  something on the first real deploy.
- **In particular, Prisma 7 under `output: "standalone"`.** The standalone server builds (64 MB,
  `server.js` present) and the Prisma runtime, query compiler chunk and `pg` driver are all inside
  it, but no process has yet connected to a database from that bundle. `deploy.sh` will catch it:
  the container healthcheck hits `/api/v1/health`, which queries Postgres, so a resolution failure
  fails the deploy instead of reaching users.
- **Provider prices and Ghana payment acceptance.** From published pages, not from a completed
  purchase.
- **No performance comparison exists.** The Render baseline in section 2 is measured. Nothing about
  the VPS is, because there is no VPS. Re-run `scripts/bench.mjs` against the new origin before
  claiming anything improved — a 4 vCPU box with NVMe *should* beat 0.5 CPU, but "should" is not a
  measurement.
