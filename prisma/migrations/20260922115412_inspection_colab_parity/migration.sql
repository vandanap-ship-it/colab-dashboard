-- Inspection · Colab-parity fields (per-item photo, chosen reviewers, submit
-- remark, and Reschedule as a first-class status).
--
-- All additive — existing rows keep passing through untouched:
--   InspectionItem.photoUrl        NULL by default; per-checkpoint photo
--   Inspection.submitRemark        NULL; free-text sent with Send For Review
--   Inspection.assignedReviewerIds text[] default '{}'; the reviewers the
--                                  filler explicitly picked, so pushes and
--                                  the queue can name them instead of
--                                  broadcasting to every planner
--   Inspection.rescheduledFor      NULL; when set with status="RESCHEDULED",
--                                  the inspection is parked until this date
--   Inspection.rescheduledNote     NULL; optional reason
--
-- The Inspection.status column stays a plain text column, so RESCHEDULED is
-- accepted as a value without any DDL change; the app-side STATUSES set is
-- widened separately.

ALTER TABLE "InspectionItem"
  ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

ALTER TABLE "Inspection"
  ADD COLUMN IF NOT EXISTS "submitRemark" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedReviewerIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "rescheduledFor" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rescheduledNote" TEXT;
