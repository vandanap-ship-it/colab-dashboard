-- Safety Induction · Shraddha 2026-10-01 pulled this out of the Phase 2
-- defer list and asked for Colab parity. See the matching Prisma model
-- comment for the full design + the colab_safety_induction_spec memory
-- for ground truth captured from Colab prod (105 workers already inducted
-- on Amanvana, EP-XXXXX ids, 12-month expiry window).

CREATE TABLE "SafetyInduction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,

    "workerName" TEXT NOT NULL,
    "workerPhotoUrl" TEXT,
    "trade" TEXT NOT NULL,
    "contractorId" TEXT,
    "gender" TEXT NOT NULL,
    "age" INTEGER,
    "dob" TIMESTAMP(3),
    "contactNumber" TEXT,
    "aadhaarNumber" TEXT,

    "aadhaarFrontUrl" TEXT,
    "aadhaarBackUrl" TEXT,
    "signatureUrl" TEXT,

    "inductionDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,

    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    "status" TEXT NOT NULL DEFAULT 'PENDING',

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "SafetyInduction_pkey" PRIMARY KEY ("id")
);

-- Unique constraints · displayId is the EP-XXXXXXXX human id shown on cards
-- and must be globally unique; idempotencyKey de-dupes offline-queue replays
-- the same way every other mobile-form model does it.
CREATE UNIQUE INDEX "SafetyInduction_displayId_key" ON "SafetyInduction"("displayId");
CREATE UNIQUE INDEX "SafetyInduction_idempotencyKey_key" ON "SafetyInduction"("idempotencyKey");

-- Hot query indexes · list page filters by project+status; the nightly
-- expiry cron scans every APPROVED row past expiryDate; "my inductions"
-- scopes by createdById; filter chips scope by contractor.
CREATE INDEX "SafetyInduction_projectId_idx" ON "SafetyInduction"("projectId");
CREATE INDEX "SafetyInduction_status_idx" ON "SafetyInduction"("status");
CREATE INDEX "SafetyInduction_expiryDate_idx" ON "SafetyInduction"("expiryDate");
CREATE INDEX "SafetyInduction_createdById_idx" ON "SafetyInduction"("createdById");
CREATE INDEX "SafetyInduction_contractorId_idx" ON "SafetyInduction"("contractorId");

-- Foreign keys · Project cascades on delete (project removal takes its
-- inductions with it). Contractor + User use RESTRICT since historical
-- audit trail outlives personnel / contractor churn — admin workaround
-- is to soft-delete the induction (deletedAt) instead of letting a FK
-- cascade silently drop it.
ALTER TABLE "SafetyInduction"
  ADD CONSTRAINT "SafetyInduction_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafetyInduction"
  ADD CONSTRAINT "SafetyInduction_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafetyInduction"
  ADD CONSTRAINT "SafetyInduction_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SafetyInduction"
  ADD CONSTRAINT "SafetyInduction_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafetyInduction"
  ADD CONSTRAINT "SafetyInduction_rejectedById_fkey"
  FOREIGN KEY ("rejectedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
