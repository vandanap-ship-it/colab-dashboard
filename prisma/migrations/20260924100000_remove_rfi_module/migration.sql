-- Rip the RFI module out of the app.
--
-- The whole feature is going: schema, API, mobile + desktop pages,
-- cron nudges, aging chips, push hooks, my-actions rows, module
-- scope. This migration drops the two tables that back it.
--
-- Hard drop, no rescue. Any existing rows disappear. Confirmed with
-- the product owner: no data to keep.
--
-- IF EXISTS on both drops makes the migration idempotent for envs
-- where an earlier manual cleanup already removed them.

DROP TABLE IF EXISTS "RfiPhoto";
DROP TABLE IF EXISTS "Rfi";
