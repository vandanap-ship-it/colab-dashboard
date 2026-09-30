-- Persist the villa tag on observations. Shraddha 2026-09-30: on
-- Thangamani's observation form he needs to tag which villa an issue
-- is in "very important", even when he doesn't pick a specific
-- activity. Prior to this the form's Villa dropdown was a client-side
-- filter only — the payload dropped villaId at the API boundary.
--
-- Nullable so pre-Sep-2026 rows are unaffected, and so a project-level
-- observation with no specific villa can still be raised.
ALTER TABLE "Issue" ADD COLUMN "villaId" TEXT;

-- Foreign key without cascade — deleting a Villa is rare and, if it
-- happens, shouldn't blow away historical observations. Use SET NULL
-- to keep the row + tell reports the villa is gone.
ALTER TABLE "Issue"
  ADD CONSTRAINT "Issue_villaId_fkey"
  FOREIGN KEY ("villaId")
  REFERENCES "Villa"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Villa-first grouping is the common report query; a plain index on
-- villaId is enough for the volumes we see.
CREATE INDEX "Issue_villaId_idx" ON "Issue"("villaId");
