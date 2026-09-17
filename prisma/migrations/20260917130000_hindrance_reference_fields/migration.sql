-- Hindrance · reference-form fields
--   endDate                    · expected end date-time (paired with startDate)
--   costImpact                 · monetary impact in project currency (INR ₹)
--   responsibleContractorId    · contractor accountable for the blocker
--                                (distinct from createdById, which is the reporter)
--   responsibleTeam            · free-text sub-team / trade under the contractor
--                                (kept as text until we model Team as its own entity)
--
-- All nullable so existing OPEN/RESOLVED rows carry over untouched.
--
-- IF NOT EXISTS / IF EXISTS guards are deliberate: an earlier attempt on
-- prod may have partially applied some of these DDLs before erroring, and
-- Postgres 9.6+ supports these clauses so re-runs land cleanly regardless
-- of which columns / constraints already exist.

ALTER TABLE "Hindrance" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "Hindrance" ADD COLUMN IF NOT EXISTS "costImpact" DOUBLE PRECISION;
ALTER TABLE "Hindrance" ADD COLUMN IF NOT EXISTS "responsibleContractorId" TEXT;
ALTER TABLE "Hindrance" ADD COLUMN IF NOT EXISTS "responsibleTeam" TEXT;

-- FK re-addable only if not already present. Postgres doesn't support
-- "ADD CONSTRAINT IF NOT EXISTS" directly, so we DROP-then-ADD; the DROP
-- is idempotent with IF EXISTS.
ALTER TABLE "Hindrance"
  DROP CONSTRAINT IF EXISTS "Hindrance_responsibleContractorId_fkey";
ALTER TABLE "Hindrance"
  ADD CONSTRAINT "Hindrance_responsibleContractorId_fkey"
    FOREIGN KEY ("responsibleContractorId") REFERENCES "Contractor"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Hindrance_responsibleContractorId_idx"
  ON "Hindrance"("responsibleContractorId");
