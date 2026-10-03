-- Why a pick was chosen, kept with the pick so it survives into the shared image and the slip page.
-- Only set for slips we built; a loaded or converted slip has no reasoning of ours behind it.
ALTER TABLE "selections" ADD COLUMN "reason" text;
