-- Add User.contractorId — optional tie so an external user's inspections /
-- issues / snags can attribute back to their contractor even when the
-- underlying WBSNode has no contractorId set (Colab imports come in like
-- that on Amanvana).

ALTER TABLE "User" ADD COLUMN "contractorId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_contractorId_idx" ON "User"("contractorId");
