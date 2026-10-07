-- Registers · Fire Extinguisher Inventory (safety team's 9th Oct-7 checklist).
-- Shraddha 2026-10-07: Girish approves, monthly sign-off. See the
-- RegisterType / Register / RegisterRow / RegisterSubmission model comments
-- in schema.prisma for the design. Additive only — no existing data touched.

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "registerRowId" TEXT;

-- CreateTable
CREATE TABLE "RegisterType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "identifierKey" TEXT NOT NULL,
    "dueDateKey" TEXT,
    "lastInspectedKey" TEXT,
    "defaultIntervalDays" INTEGER,
    "signOffIntervalDays" INTEGER,
    "inspectionTemplateCode" TEXT,
    "preparedByLabel" TEXT,
    "approvedByLabel" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisterType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Register" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "signOffNudgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterRow" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierNorm" TEXT NOT NULL,
    "nextDueDate" TIMESTAMP(3),
    "villaId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "retiredReason" TEXT,
    "firstSubmittedAt" TIMESTAMP(3),
    "lastInspectionId" TEXT,
    "dueSoonNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "RegisterRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterSubmission" (
    "id" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "signedPaperUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT,

    CONSTRAINT "RegisterSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegisterType_code_key" ON "RegisterType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Register_projectId_typeId_key" ON "Register"("projectId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterRow_idempotencyKey_key" ON "RegisterRow"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RegisterRow_registerId_idx" ON "RegisterRow"("registerId");

-- CreateIndex
CREATE INDEX "RegisterRow_nextDueDate_idx" ON "RegisterRow"("nextDueDate");

-- CreateIndex
CREATE INDEX "RegisterRow_villaId_idx" ON "RegisterRow"("villaId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterSubmission_displayId_key" ON "RegisterSubmission"("displayId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterSubmission_idempotencyKey_key" ON "RegisterSubmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RegisterSubmission_registerId_idx" ON "RegisterSubmission"("registerId");

-- CreateIndex
CREATE INDEX "RegisterSubmission_status_idx" ON "RegisterSubmission"("status");

-- CreateIndex
CREATE INDEX "Inspection_registerRowId_idx" ON "Inspection"("registerRowId");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_registerRowId_fkey" FOREIGN KEY ("registerRowId") REFERENCES "RegisterRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Register" ADD CONSTRAINT "Register_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Register" ADD CONSTRAINT "Register_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RegisterType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterRow" ADD CONSTRAINT "RegisterRow_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterRow" ADD CONSTRAINT "RegisterRow_villaId_fkey" FOREIGN KEY ("villaId") REFERENCES "Villa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterRow" ADD CONSTRAINT "RegisterRow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterRow" ADD CONSTRAINT "RegisterRow_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSubmission" ADD CONSTRAINT "RegisterSubmission_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Register"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSubmission" ADD CONSTRAINT "RegisterSubmission_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSubmission" ADD CONSTRAINT "RegisterSubmission_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterSubmission" ADD CONSTRAINT "RegisterSubmission_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

