# gameclaw

Betting slip assistant for Ghana. Load a booking code, convert it between bookmakers, edit it (remove, safest N, trim to odds, split), check match stats, or ask the AI assistant to do it in plain English. 18+.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Supabase (Postgres, Auth) · Prisma 7 · Anthropic API · API-Football · Paystack · PWA

## Layout
```
app/(main)/          public shell: landing, slip, convert, matches, chat, pricing, account, legal
app/(auth)/          login + 18+ confirmation
app/api/v1/          REST API shared by web, Telegram bot and mobile app
lib/bookmakers/      BookmakerAdapter interface, one file per bookmaker, registry (mock | live)
lib/markets/         internal market model (type + period + outcome + line) and labels
lib/matching/        team-name normalisation, aliases, fuzzy matching, kickoff ±15 min
lib/slips/           pure slip logic: views, totals, warnings, edit operations
lib/stats/           API-Football client (cached), sample provider, form & insights
lib/ai/              agent loop, tools, models/pricing, deep analysis
lib/billing/         Paystack client
lib/services/        business logic used by API routes, pages and AI tools
prisma/              schema, migrations (incl. RLS SQL), seed
tests/               unit tests; tests/integration runs services against real Postgres
docs/                deploy guide, bookmaker capture guide
```

## Getting started
```bash
pnpm install
cp .env.example .env.local        # fill in Supabase + DB values
pnpm db:migrate && pnpm db:seed
pnpm dev
```
Deploying: see [docs/deploy.md](docs/deploy.md).

## API conventions
- Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "details?" } }` (codes in `lib/errors.ts`).
- Auth: Supabase session cookie (web) or `Authorization: Bearer <supabase access token>` (bot / mobile).

| Endpoint | |
|---|---|
| `POST /api/v1/slips/load` | `{ bookmaker, code }` → slip |
| `POST /api/v1/slips/convert` | `{ slipId \| bookmaker+code, target }` → converted slip (unmatched games kept with reasons) |
| `POST /api/v1/slips/:id/edit` | `{ op: remove \| safest \| trim \| split, book }` → new slip(s) with codes |
| `GET /api/v1/slips`, `/slips/:id` | history |
| `GET /api/v1/matches?date=`, `/matches/:id`, `/matches/lookup` | stats |
| `POST /api/v1/matches/:id/analysis` | deep AI analysis (paid plans) |
| `POST /api/v1/ai/chat` | `{ messages, matchId? }` → reply + slips touched |
| `POST /api/v1/billing/checkout` | `{ plan }` → Paystack URL |
| `POST /api/v1/webhooks/paystack` | signed webhook |

## Bookmaker adapters
Each adapter maps to the internal market model; unknown markets are logged (`bookmaker.unmapped_market`) and shown to the user, never dropped. `SPORTYBET_MODE` / `BETWAY_MODE` switch mock ↔ live. Live mode is intentionally unimplemented until real requests are captured ([guide](docs/capturing-bookmaker-requests.md)).

### Mock booking codes
| SportyBet | Betway | Case |
|---|---|---|
| `BC7K2Q` | `BW5V8N` | Valid slip (8 / 6 games) |
| `BCLIVE` | `BWLIVE` | A started game + an unsupported market |
| `BCEXP1` | `BWEXP1` | Expired |
| `BCDOWN` | `BWDOWN` | Bookmaker unavailable |
| anything else | anything else | Invalid |

## Tests
```bash
pnpm test        # unit tests (no DB)
pnpm test:int    # integration tests against a disposable Postgres, see tests/integration/README.md
```
CI (`.github/workflows/ci.yml`) runs lint, typecheck, both suites and a build.

## Scripts
`dev` · `build` · `lint` · `typecheck` · `test` · `test:int` · `db:migrate` · `db:seed` · `db:studio`
