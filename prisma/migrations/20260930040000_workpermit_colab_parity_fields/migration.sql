-- Colab-parity fields on WorkPermit — matches the 4-step wizard's
-- Step 3 checklist output + SUSPENDED state tracking.

ALTER TABLE "WorkPermit"
  ADD COLUMN "checklistResponses" JSONB,
  ADD COLUMN "suspendedById"      TEXT,
  ADD COLUMN "suspendedAt"        TIMESTAMP(3),
  ADD COLUMN "suspendedReason"    TEXT;

ALTER TABLE "WorkPermit"
  ADD CONSTRAINT "WorkPermit_suspendedById_fkey"
  FOREIGN KEY ("suspendedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
