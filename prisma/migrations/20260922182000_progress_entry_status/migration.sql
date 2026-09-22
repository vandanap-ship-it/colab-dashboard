-- Progress drafts, step 1: add the status column. PUBLISHED is the
-- everything-else default, so every row created before this migration
-- (and every row from a caller that hasn't been updated yet) stays
-- fully live in reports + rollups. DRAFT rows will land once the API +
-- form are wired to emit them.
ALTER TABLE "ProgressEntry"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PUBLISHED';
