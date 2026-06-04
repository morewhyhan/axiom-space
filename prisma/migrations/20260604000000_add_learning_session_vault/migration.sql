ALTER TABLE "learningSession" ADD COLUMN "vaultId" TEXT REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "learningSession"
SET "vaultId" = (
  SELECT "id"
  FROM "vault"
  WHERE "vault"."userId" = "learningSession"."userId"
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "domain" = '__agent__' AND "vaultId" IS NULL;

CREATE INDEX "learningSession_userId_vaultId_idx" ON "learningSession"("userId", "vaultId");
CREATE INDEX "learningSession_vaultId_idx" ON "learningSession"("vaultId");
