-- CreateTable
CREATE TABLE "team_logos" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_logos_pkey" PRIMARY KEY ("key")
);


-- Server-only table (read via Prisma); keep it closed to the anon key like the other caches.
ALTER TABLE "team_logos" ENABLE ROW LEVEL SECURITY;
