-- Deactivate the leftover `test` user and strip its permit-approver flag.
-- Shraddha 2026-09-30: only Girish R should show in the Approver picker for
-- Safety permits; a stray `test` account with canApproveWorkPermits=true
-- was surfacing next to him on Abhishek's phone.
--
-- Soft-only: sets active=false so the user cannot log in and is filtered
-- out of every "active users" query, and clears canApproveWorkPermits
-- so a future re-activation doesn't silently re-add them to the picker.
-- Historical rows the test user owns (audit log, any prior permits) stay
-- untouched — this is not a delete.
UPDATE "User"
SET "active" = false,
    "canApproveWorkPermits" = false,
    "updatedAt" = NOW()
WHERE "username" = 'test'
  AND "active" = true;
