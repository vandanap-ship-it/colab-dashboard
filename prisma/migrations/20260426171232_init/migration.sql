-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SITE_ENGINEER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "reraEndDate" DATETIME,
    "address" TEXT,
    "logoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contractor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WBSNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "taskCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "baselineStart" DATETIME,
    "baselineFinish" DATETIME,
    "actualStart" DATETIME,
    "actualFinish" DATETIME,
    "projectedFinish" DATETIME,
    "percentComplete" REAL NOT NULL DEFAULT 0,
    "category" TEXT,
    "predecessorsRaw" TEXT,
    "totalQuantity" REAL,
    "unit" TEXT,
    "contractorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WBSNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WBSNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WBSNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WBSNode_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LABOUR_SUPPLY',
    "achievedQuantity" REAL NOT NULL DEFAULT 0,
    "cumulativeQuantity" REAL NOT NULL DEFAULT 0,
    "contractorId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProgressEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProgressEntry_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WBSNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProgressEntry_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProgressEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProgressLabour" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "progressEntryId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    CONSTRAINT "ProgressLabour_progressEntryId_fkey" FOREIGN KEY ("progressEntryId") REFERENCES "ProgressEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "progressEntryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressPhoto_progressEntryId_fkey" FOREIGN KEY ("progressEntryId") REFERENCES "ProgressEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Hindrance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "description" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "resolvedDate" DATETIME,
    "daysImpact" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hindrance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hindrance_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WBSNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Hindrance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Concern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "raisedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Concern_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Concern_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Project_createdById_idx" ON "Project"("createdById");

-- CreateIndex
CREATE INDEX "Contractor_projectId_idx" ON "Contractor"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_projectId_name_key" ON "Contractor"("projectId", "name");

-- CreateIndex
CREATE INDEX "WBSNode_projectId_idx" ON "WBSNode"("projectId");

-- CreateIndex
CREATE INDEX "WBSNode_parentId_idx" ON "WBSNode"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WBSNode_projectId_taskCode_key" ON "WBSNode"("projectId", "taskCode");

-- CreateIndex
CREATE INDEX "ProgressEntry_projectId_date_idx" ON "ProgressEntry"("projectId", "date");

-- CreateIndex
CREATE INDEX "ProgressEntry_wbsNodeId_idx" ON "ProgressEntry"("wbsNodeId");

-- CreateIndex
CREATE INDEX "ProgressLabour_progressEntryId_idx" ON "ProgressLabour"("progressEntryId");

-- CreateIndex
CREATE INDEX "ProgressPhoto_progressEntryId_idx" ON "ProgressPhoto"("progressEntryId");

-- CreateIndex
CREATE INDEX "Hindrance_projectId_idx" ON "Hindrance"("projectId");

-- CreateIndex
CREATE INDEX "Concern_projectId_idx" ON "Concern"("projectId");

-- CreateIndex
CREATE INDEX "Issue_projectId_idx" ON "Issue"("projectId");
