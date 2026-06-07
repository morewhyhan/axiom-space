-- Persist Agent audit events for production incident review and compliance.
CREATE TABLE "agentAuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "vaultId" TEXT,
  "sessionId" TEXT,
  "level" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agentAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agentAuditLog_userId_idx" ON "agentAuditLog"("userId");
CREATE INDEX "agentAuditLog_vaultId_idx" ON "agentAuditLog"("vaultId");
CREATE INDEX "agentAuditLog_sessionId_idx" ON "agentAuditLog"("sessionId");
CREATE INDEX "agentAuditLog_category_idx" ON "agentAuditLog"("category");
CREATE INDEX "agentAuditLog_createdAt_idx" ON "agentAuditLog"("createdAt");
