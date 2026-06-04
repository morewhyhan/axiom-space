import { PrismaClient } from '../node_modules/.pnpm/@prisma+client@6.19.2_prisma@6.19.2_typescript@5.6.2__typescript@5.6.2/node_modules/@prisma/client/default.js'

const prisma = new PrismaClient()

const models = [
  ['users', () => prisma.user.count()],
  ['accounts', () => prisma.account.count()],
  ['vaults', () => prisma.vault.count()],
  ['clusters', () => prisma.cluster.count()],
  ['cards', () => prisma.card.count()],
  ['edges', () => prisma.edge.count()],
  ['learningSessions', () => prisma.learningSession.count()],
  ['learningPaths', () => prisma.learningPath.count()],
  ['learningPathSteps', () => prisma.learningPathStep.count()],
  ['agentSessions', () => prisma.agentSession.count()],
  ['vaultMemories', () => prisma.vaultMemory.count()],
  ['vaultCapabilities', () => prisma.vaultCapability.count()],
  ['educationProfileHistory', () => prisma.EducationProfileHistory.count()],
  ['pathAdjustmentHistory', () => prisma.PathAdjustmentHistory.count()],
  ['pushRecords', () => prisma.PushRecord.count()],
]

for (const [name, fn] of models) {
  try {
    console.log(name, await fn())
  } catch (err) {
    console.log(name, 'ERR', err.code || err.message)
  }
}

const demo = await prisma.user.findUnique({
  where: { email: 'demo@axiom.space' },
  include: {
    vaults: true,
    learningPaths: true,
    learningSessions: true,
    pushRecords: true,
  },
})

console.log('demo-user', JSON.stringify({
  id: demo?.id,
  email: demo?.email,
  vaults: demo?.vaults.map(v => ({ id: v.id, name: v.name })),
  learningPaths: demo?.learningPaths.map(p => ({ id: p.id, name: p.name, status: p.status })),
  learningSessions: demo?.learningSessions.map(s => ({ id: s.id, domain: s.domain, concept: s.concept, status: s.status })),
  pushRecords: demo?.pushRecords.map(r => ({ id: r.id, trigger: r.trigger, viewedAt: r.viewedAt })),
}, null, 2))

await prisma.$disconnect()
