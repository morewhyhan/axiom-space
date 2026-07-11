import { prisma } from '@/lib/db'

const EMAIL = process.env.A3_CHECK_EMAIL || process.env.A3_SEED_EMAIL || 'demo@axiom.space'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (!user) throw new Error(`${EMAIL} does not exist`)

  const vaults = await prisma.vault.findMany({
    where: { userId: user.id },
    orderBy: { name: 'asc' },
    select: {
      name: true,
      vaultMemories: {
        where: { category: 'observation' },
        orderBy: { createdAt: 'asc' },
        select: { value: true },
      },
    },
  })

  for (const vault of vaults) {
    console.log(`\nVAULT: ${vault.name}`)
    for (const memory of vault.vaultMemories) {
      const value = JSON.parse(memory.value) as Record<string, unknown>
      const category = typeof value.category === 'string' ? value.category : ''
      if (!category.startsWith('profile_')) continue
      console.log(`- ${category.slice('profile_'.length)} / ${String(value.subDimensionLabel || '未命名')}`)
      console.log(`  摘要: ${String(value.userFacingSummary || value.text || '')}`)
      console.log(`  机制: ${String(value.mechanismHypothesis || '')}`)
      console.log(`  干预: ${String(value.teachingIntervention || '')}`)
      console.log(`  验证: ${String(value.verificationCriterion || '')}`)
    }
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
