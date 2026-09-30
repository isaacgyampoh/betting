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

## Scripts
`dev` · `build` · `lint` · `typecheck` · `db:migrate` · `db:migrate:dev` · `db:seed` · `db:studio`
