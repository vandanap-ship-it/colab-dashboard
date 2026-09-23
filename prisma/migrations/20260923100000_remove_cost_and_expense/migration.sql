-- Rip cost tracking out of the app.
--
--   1. Drop Hindrance.costImpact — the "Cost Impact" ₹ field on the
--      mobile hindrance form. The field was optional (Float?), the
--      column drop is unconditional. Any rows that had a value lose it.
--   2. Drop the Expense + ExpensePhoto tables entirely — the Expense
--      module was already removed from the UI in task #103; this
--      removes the leftover tables + FKs. IF EXISTS on both drops
--      makes the migration idempotent for envs where an earlier
--      manual cleanup already removed them.
--   3. Sub-contractor billing (SubContractorBill / …BillLine) STAYS —
--      that's a separate feature and is not what "cost" meant here.

ALTER TABLE "Hindrance" DROP COLUMN IF EXISTS "costImpact";

DROP TABLE IF EXISTS "ExpensePhoto";
DROP TABLE IF EXISTS "Expense";
