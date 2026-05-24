-- DropIndex
DROP INDEX "vault_userId_key";

-- CreateIndex
CREATE INDEX "vault_userId_idx" ON "vault"("userId");
