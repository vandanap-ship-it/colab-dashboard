-- Colab-parity: Night Work permit's "Details of Personnel in Attendance"
-- section reuses the labour-entry row shape (name / role / count) with a
-- `kind` discriminator to keep it distinct from the general Labour list.

ALTER TABLE "PermitLabourEntry" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'LABOUR';

CREATE INDEX "PermitLabourEntry_kind_idx" ON "PermitLabourEntry"("kind");
