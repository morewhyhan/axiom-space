-- Add vault scoping to resource push records so recommendations do not leak across vaults.
ALTER TABLE "PushRecord" ADD COLUMN "vaultId" TEXT;

UPDATE "PushRecord"
SET "vaultId" = (
  SELECT "id"
  FROM "vault"
  WHERE "vault"."userId" = "PushRecord"."userId"
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "vaultId" IS NULL;

CREATE INDEX "PushRecord_userId_vaultId_idx" ON "PushRecord"("userId", "vaultId");
CREATE INDEX "PushRecord_vaultId_idx" ON "PushRecord"("vaultId");
