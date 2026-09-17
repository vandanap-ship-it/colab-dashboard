-- Opt-in flags for the daily site-team automations. Both were previously
-- hardcoded username allowlists (`harish.bs`, `madhavarajan.s`) in the cron
-- endpoints — moving the setting onto User rows means Admin > Users owns
-- who's in and who's out, not shipped code.

ALTER TABLE "User"
  ADD COLUMN "receivesDailyTaskEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "receivesDailyNudge"     BOOLEAN NOT NULL DEFAULT false;

-- Seed the two current recipients so nothing changes on the next 07:00
-- IST cron run. If either username isn't found (fresh DB, renamed
-- account), UPDATE affects zero rows — safe.
UPDATE "User"
   SET "receivesDailyTaskEmail" = TRUE,
       "receivesDailyNudge"     = TRUE
 WHERE "username" IN ('harish.bs', 'madhavarajan.s');
