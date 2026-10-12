-- Add Contractor.showInPickers to allow hiding auto-created labour-supply
-- vendors from mobile pickers without soft-deleting the row.
-- See prisma/schema.prisma for the full field comment.
ALTER TABLE "Contractor" ADD COLUMN "showInPickers" BOOLEAN NOT NULL DEFAULT true;
