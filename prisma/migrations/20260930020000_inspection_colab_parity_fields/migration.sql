-- Colab-parity fields on Inspection so mobile WIR form can match Colab
-- exactly (contractor picker, exact location text, quantity fields).
-- All nullable, so existing rows and current API callers stay valid.

ALTER TABLE "Inspection"
  ADD COLUMN "contractorId"        TEXT,
  ADD COLUMN "exactLocation"       TEXT,
  ADD COLUMN "totalQuantityPct"    DOUBLE PRECISION,
  ADD COLUMN "executedQuantityPct" DOUBLE PRECISION;

ALTER TABLE "Inspection"
  ADD CONSTRAINT "Inspection_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Inspection_contractorId_idx" ON "Inspection"("contractorId");
