-- Colab-parity: WorkPermit.closedReason captures the required reason
-- from the Close Permit bottom sheet. Nullable so existing closes
-- (pre-Oct 13 2026) read as blank; the API enforces required on new
-- close actions.
ALTER TABLE "WorkPermit" ADD COLUMN "closedReason" TEXT;
