-- CreateTable
CREATE TABLE "HindrancePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hindranceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HindrancePhoto_hindranceId_fkey" FOREIGN KEY ("hindranceId") REFERENCES "Hindrance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConcernPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "concernId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConcernPhoto_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IssuePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssuePhoto_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Concern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "raisedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Concern_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Concern_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WBSNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Concern_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Concern_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Concern" ("createdAt", "description", "id", "projectId", "raisedById", "status", "updatedAt") SELECT "createdAt", "description", "id", "projectId", "raisedById", "status", "updatedAt" FROM "Concern";
DROP TABLE "Concern";
ALTER TABLE "new_Concern" RENAME TO "Concern";
CREATE INDEX "Concern_projectId_idx" ON "Concern"("projectId");
CREATE INDEX "Concern_assignedToId_idx" ON "Concern"("assignedToId");
CREATE TABLE "new_Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "description" TEXT NOT NULL,
    "severity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WBSNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("createdAt", "createdById", "description", "id", "projectId", "severity", "status", "updatedAt") SELECT "createdAt", "createdById", "description", "id", "projectId", "severity", "status", "updatedAt" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE INDEX "Issue_projectId_idx" ON "Issue"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "HindrancePhoto_hindranceId_idx" ON "HindrancePhoto"("hindranceId");

-- CreateIndex
CREATE INDEX "ConcernPhoto_concernId_idx" ON "ConcernPhoto"("concernId");

-- CreateIndex
CREATE INDEX "IssuePhoto_issueId_idx" ON "IssuePhoto"("issueId");
