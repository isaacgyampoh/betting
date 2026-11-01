# GameClaw API image: the same Next.js application Render runs, built to stand alone.
#
# Debian slim rather than Alpine. Prisma 7 ships prebuilt query engines linked against glibc and
# OpenSSL 3; on musl it needs a different engine target and the failure is a runtime
# "Unable to require libquery_engine" rather than a build error, which is a bad thing to discover
# on a production cutover. The size difference is about 40 MB and does not matter here.
#
# Three stages. `builder` keeps the full toolchain and is also the image migrations run from, so
# the Prisma CLI never has to be shipped in the serving image. `runner` carries only the standalone
# server, so it starts fast and has nothing in it to exploit.

# ---------------------------------------------------------------------------- deps
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The pnpm version is pinned by packageManager in package.json; corepack honours it exactly.
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc* ./
# Dev dependencies are needed: the build runs next, prisma and tsx.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------- builder
FROM deps AS builder
WORKDIR /app
COPY . .
# Generated into lib/generated/prisma (see the generator block in prisma/schema.prisma), which the
# application imports directly, so this has to happen before next build.
RUN pnpm db:generate
# DOCKER_BUILD switches next.config.ts to standalone output. No database is contacted: lib/db.ts
# builds its client lazily precisely so a build needs no DATABASE_URL.
ENV DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1
ARG GIT_COMMIT=dev
ENV GITHUB_SHA=$GIT_COMMIT
RUN pnpm build

# ---------------------------------------------------------------------------- runner
FROM node:24-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Standalone already contains the traced node_modules it needs, so nothing is installed here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
# Hits the application's own health route, so the container is unhealthy when the database is
# unreachable rather than merely when the process has died.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "server.js"]
