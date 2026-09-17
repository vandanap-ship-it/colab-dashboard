-- Hindrance · reference-form fields
--   endDate                    · expected end date-time (paired with startDate)
--   costImpact                 · monetary impact in project currency (INR ₹)
--   responsibleContractorId    · contractor accountable for the blocker
--                                (distinct from createdById, which is the reporter)
--   responsibleTeam            · free-text sub-team / trade under the contractor
--                                (kept as text until we model Team as its own entity)
--
-- All nullable so existing OPEN/RESOLVED rows carry over untouched.

ALTER TABLE "Hindrance"
  ADD COLUMN "endDate" TIMESTAMP(3),
  ADD COLUMN "costImpact" DOUBLE PRECISION,
  ADD COLUMN "responsibleContractorId" TEXT,
  ADD COLUMN "responsibleTeam" TEXT;

ALTER TABLE "Hindrance"
  ADD CONSTRAINT "Hindrance_responsibleContractorId_fkey"
    FOREIGN KEY ("responsibleContractorId") REFERENCES "Contractor"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Hindrance_responsibleContractorId_idx"
  ON "Hindrance"("responsibleContractorId");
