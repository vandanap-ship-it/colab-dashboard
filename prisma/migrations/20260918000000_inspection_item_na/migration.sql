-- InspectionItem · Yes / No / NA three-way response (Colab QA/QC parity).
--
-- Before: passed Boolean? — null = not answered, true = Yes, false = No.
-- After: same passed column, plus a notApplicable boolean marker. The three
-- reader-friendly states are:
--   notApplicable = true                       → NA
--   notApplicable = false, passed = true       → Yes
--   notApplicable = false, passed = false      → No
--   notApplicable = false, passed = null       → not answered
--
-- Kept as an additive column so every existing row is Yes/No exactly like
-- it was before. No backfill needed.
ALTER TABLE "InspectionItem"
  ADD COLUMN IF NOT EXISTS "notApplicable" BOOLEAN NOT NULL DEFAULT FALSE;
