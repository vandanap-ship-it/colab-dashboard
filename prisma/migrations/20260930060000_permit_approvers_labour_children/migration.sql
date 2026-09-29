-- Colab-parity: PermitApprover + PermitLabourEntry child tables, plus a
-- handful of WorkPermit columns needed for the wizard/Step-4 review side.

ALTER TABLE "WorkPermit"
  ADD COLUMN "displayId"              TEXT,
  ADD COLUMN "coRequesterIds"         TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "activityHead"           TEXT,
  ADD COLUMN "suspensionResolvedAt"   TIMESTAMP(3),
  ADD COLUMN "suspensionResolvedById" TEXT;

CREATE INDEX "WorkPermit_displayId_idx" ON "WorkPermit"("displayId");

CREATE TABLE "PermitApprover" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "workPermitId" TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "levelIndex"   INTEGER NOT NULL DEFAULT 1,
  "levelName"    TEXT,
  "canClose"     BOOLEAN NOT NULL DEFAULT true,
  "canSuspend"   BOOLEAN NOT NULL DEFAULT false,
  "isDefault"    BOOLEAN NOT NULL DEFAULT false,
  "orderIndex"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "PermitApprover"
  ADD CONSTRAINT "PermitApprover_workPermitId_fkey"
  FOREIGN KEY ("workPermitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE;

ALTER TABLE "PermitApprover"
  ADD CONSTRAINT "PermitApprover_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id");

CREATE UNIQUE INDEX "PermitApprover_workPermitId_userId_levelIndex_key"
  ON "PermitApprover"("workPermitId", "userId", "levelIndex");
CREATE INDEX "PermitApprover_workPermitId_idx" ON "PermitApprover"("workPermitId");
CREATE INDEX "PermitApprover_userId_idx"       ON "PermitApprover"("userId");

CREATE TABLE "PermitLabourEntry" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "workPermitId" TEXT NOT NULL,
  "workerName"   TEXT,
  "role"         TEXT,
  "count"        INTEGER,
  "orderIndex"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "PermitLabourEntry"
  ADD CONSTRAINT "PermitLabourEntry_workPermitId_fkey"
  FOREIGN KEY ("workPermitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE;

CREATE INDEX "PermitLabourEntry_workPermitId_idx" ON "PermitLabourEntry"("workPermitId");
