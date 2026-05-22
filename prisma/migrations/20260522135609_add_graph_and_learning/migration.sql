-- CreateTable
CREATE TABLE "cluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#a855f7',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cluster_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "type" TEXT NOT NULL DEFAULT 'related',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edge_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "edge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "card" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "edge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "phase" TEXT NOT NULL DEFAULT 'explore',
    "outcome" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "learningSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learningMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    CONSTRAINT "learningMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "learningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "clusterId" TEXT,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'fleeting',
    "title" TEXT,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "card_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "card_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "cluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_card" ("content", "createdAt", "id", "path", "tags", "title", "type", "updatedAt", "vaultId") SELECT "content", "createdAt", "id", "path", "tags", "title", "type", "updatedAt", "vaultId" FROM "card";
DROP TABLE "card";
ALTER TABLE "new_card" RENAME TO "card";
CREATE INDEX "card_vaultId_type_idx" ON "card"("vaultId", "type");
CREATE INDEX "card_clusterId_idx" ON "card"("clusterId");
CREATE UNIQUE INDEX "card_vaultId_path_key" ON "card"("vaultId", "path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "cluster_vaultId_idx" ON "cluster"("vaultId");

-- CreateIndex
CREATE INDEX "edge_vaultId_idx" ON "edge"("vaultId");

-- CreateIndex
CREATE INDEX "edge_sourceId_idx" ON "edge"("sourceId");

-- CreateIndex
CREATE INDEX "edge_targetId_idx" ON "edge"("targetId");

-- CreateIndex
CREATE INDEX "learningSession_userId_idx" ON "learningSession"("userId");

-- CreateIndex
CREATE INDEX "learningMessage_sessionId_idx" ON "learningMessage"("sessionId");
