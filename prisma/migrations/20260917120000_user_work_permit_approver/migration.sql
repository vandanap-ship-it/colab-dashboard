-- User.canApproveWorkPermits — replaces the "every internal-staff user is an
-- eligible work-permit approver" default. Admin > Users toggles which users
-- appear in the approver picker on the mobile Raise Permit form.

ALTER TABLE "User"
  ADD COLUMN "canApproveWorkPermits" BOOLEAN NOT NULL DEFAULT false;

-- Seed the current designated approver so the list on prod isn't empty on
-- the next Raise Permit tap. Girish R (SITE_MANAGER) is the one Shraddha
-- named. UPDATE affects zero rows on a fresh DB — safe.
UPDATE "User"
   SET "canApproveWorkPermits" = TRUE
 WHERE "username" = 'girish.r';
