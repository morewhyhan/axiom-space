import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const email = process.env.A3_RECORD_EMAIL || 'demo@axiom.space'
const vaultId = 'a3-cap-import-proof-vault-20260718'
const vaultName = '设计模式黄金案例·导入演示'

async function clearDetachedFacts(id: string) {
  const tables = [
    'assessmentResult',
    'cardRevision',
    'promotionAttempt',
    'domainEvent',
    'AgentConfirmationToken',
    'agentAuditLog',
    'sourceDocument',
  ]

  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "vaultId" = $1`, id)
  }
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })

  await clearDetachedFacts(vaultId)
  await prisma.vault.deleteMany({ where: { id: vaultId } })
  await prisma.vault.create({
    data: {
      id: vaultId,
      userId: user.id,
      name: vaultName,
    },
  })

  console.log(JSON.stringify({
    ok: true,
    user: email,
    vaultId,
    vault: vaultName,
    cards: 0,
    purpose: 'record document import from visible action to visible graph result',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
