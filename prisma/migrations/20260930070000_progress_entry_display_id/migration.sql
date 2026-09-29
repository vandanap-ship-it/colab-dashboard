-- Colab-parity: human-readable ProgressEntry id (PROG-XXXXXXXX) shown
-- on Site Progress activity cards. Nullable so historical rows keep
-- round-tripping; the API populates new rows at create time.

ALTER TABLE "ProgressEntry" ADD COLUMN "displayId" TEXT;

CREATE INDEX "ProgressEntry_displayId_idx" ON "ProgressEntry"("displayId");
