# gameclaw

AI-powered betting slip assistant for Ghana: load, convert and edit booking codes, check match stats, and chat with an assistant that uses tools, never invented data.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Supabase (Postgres, Auth) · Prisma 7 (`@prisma/adapter-pg`) · Zod · PWA

## Layout
```
app/(main)/         public shell: landing, slip tools, legal pages, account, chat
app/(auth)/         login + 18+ confirmation (/welcome)
app/auth/           OAuth/magic-link callback, sign-out
app/api/v1/         REST API shared by web, Telegram bot and mobile app
lib/                business logic (services, auth, db, env, errors)
prisma/             schema, migrations (incl. RLS SQL), seed
proxy.ts            session refresh + route protection (Next 16's replacement for middleware)
```

## Setup
```bash
pnpm install
cp .env.example .env.local        # fill in Supabase + DB values
pnpm db:migrate                   # apply migrations (uses DIRECT_URL)
pnpm db:seed                      # plans + bookmakers
pnpm dev
```

## API conventions
- Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "details?" } }`
- Auth: Supabase session cookie (web) or `Authorization: Bearer <supabase access token>` (bot/mobile).

## Bookmaker adapters
`lib/bookmakers/` has one file per bookmaker implementing `BookmakerAdapter` (`types.ts`); `registry.ts` picks mock or live per bookmaker from `SPORTYBET_MODE` / `BETWAY_MODE`. Every adapter maps to the internal market model in `lib/markets/` (type + period + outcome + line). Unknown markets are logged (`bookmaker.unmapped_market`) and shown to the user; they never crash a load.

### Mock booking codes
| SportyBet | Betway | Case |
|---|---|---|
| `BC7K2Q` | `BW5V8N` | Valid slip (8 / 6 games) |
| `BCLIVE` | `BWLIVE` | A game already started + an unsupported market (corners) |
| `BCEXP1` | `BWEXP1` | Expired code |
| `BCDOWN` | `BWDOWN` | Bookmaker unavailable |
| anything else | anything else | Invalid code |

Mock kickoffs are relative to the current time, so slips never go stale.

## Scripts
`dev` · `build` · `lint` · `typecheck` · `test` · `db:migrate` · `db:seed` · `db:studio`
