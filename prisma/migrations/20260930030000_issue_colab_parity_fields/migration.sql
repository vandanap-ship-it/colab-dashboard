-- Colab-parity fields on Issue — matches the Observations form Thangamani
-- fills when raising an Issue from a WIR mid-inspection.

ALTER TABLE "Issue"
  ADD COLUMN "parallelAssigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dueDate"             TIMESTAMP(3),
  ADD COLUMN "debitToId"           TEXT,
  ADD COLUMN "debitAmount"         DOUBLE PRECISION,
  ADD COLUMN "inspectionId"        TEXT;

ALTER TABLE "Issue"
  ADD CONSTRAINT "Issue_debitToId_fkey"
  FOREIGN KEY ("debitToId") REFERENCES "Contractor"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Issue"
  ADD CONSTRAINT "Issue_inspectionId_fkey"
  FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Issue_debitToId_idx"    ON "Issue"("debitToId");
CREATE INDEX "Issue_inspectionId_idx" ON "Issue"("inspectionId");

-- Migrate existing severity values to Colab's Minor/Major/Critical vocab.
-- Anything else stays as-is (defensive; a null stays null).
UPDATE "Issue" SET "severity" = 'Minor'    WHERE "severity" ILIKE 'low';
UPDATE "Issue" SET "severity" = 'Critical' WHERE "severity" ILIKE 'high';
