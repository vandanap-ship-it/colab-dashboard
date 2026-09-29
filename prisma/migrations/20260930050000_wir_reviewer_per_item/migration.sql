-- Colab-parity: per-item reviewer feedback + Trigger Type + top-level
-- reviewer note. Enables the "Approver 1" row per item (comment +
-- camera) and the summary card's Trigger Type value.
-- Shraddha 2026-09-30 clarified the chat icon "is just to enter
-- comments" — so 💬 chat and ↩ Add Reply share the reviewerNote column.

ALTER TABLE "Inspection"
  ADD COLUMN "triggerType"    TEXT DEFAULT 'Manual',
  ADD COLUMN "reviewerNote"   TEXT;

ALTER TABLE "InspectionItem"
  ADD COLUMN "reviewerNote"     TEXT,
  ADD COLUMN "reviewerPhotoUrl" TEXT;
