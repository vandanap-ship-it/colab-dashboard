-- Add rawColabRow JSONB column to preserve full Colab CSV rows verbatim,
-- so the Master Report can export a byte-for-byte Colab-format raw
-- activity CSV. Nullable: existing rows stay untouched until the next
-- Colab progress import runs and re-populates them.
ALTER TABLE "ColabActivity" ADD COLUMN "rawColabRow" JSONB;
