-- Add plannedPct column to ColabActivity so the Master Report can
-- compute overall Planned % straight from Colab's own Planned_Progress_%
-- column (matches the numbers Colab's dashboards produce). Nullable;
-- populated by the next Colab progress import.
ALTER TABLE "ColabActivity" ADD COLUMN "plannedPct" DOUBLE PRECISION;
