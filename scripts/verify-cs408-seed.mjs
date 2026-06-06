import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const VAULT_NAME = 'CS408 Knowledge Graph'

function pass(label, ok, detail) {
  const marker = ok ? 'PASS' : 'FAIL'
  console.log(`${marker} ${label}: ${detail}`)
  return ok
}

try {
  const vault = await prisma.vault.findFirst({
    where: { name: VAULT_NAME },
    include: { user: true },
  })

  if (!vault) {
    console.error(`FAIL vault: ${VAULT_NAME} not found`)
    process.exit(1)
  }

  const [
    clusters,
    cards,
    edges,
    paths,
    pathSteps,
    profileHistoryCount,
    capabilities,
    skills,
    pushes,
    memories,
    agentSessions,
    indexedCount,
  ] = await Promise.all([
    prisma.cluster.findMany({ where: { vaultId: vault.id } }),
    prisma.card.findMany({ where: { vaultId: vault.id }, include: { cluster: true } }),
    prisma.edge.findMany({ where: { vaultId: vault.id }, include: { source: { include: { cluster: true } }, target: { include: { cluster: true } } } }),
    prisma.learningPath.findMany({ where: { vaultId: vault.id } }),
    prisma.learningPathStep.findMany({ where: { path: { vaultId: vault.id } } }),
    prisma.educationProfileHistory.count({ where: { vaultId: vault.id } }),
    prisma.vaultCapability.findMany({ where: { vaultId: vault.id } }),
    prisma.vaultSkill.findMany({ where: { vaultId: vault.id } }),
    prisma.pushRecord.findMany({ where: { vaultId: vault.id } }),
    prisma.vaultMemory.findMany({ where: { vaultId: vault.id } }),
    prisma.agentSession.findMany({ where: { vaultId: vault.id } }),
    prisma.ragDocumentIndex.count({ where: { vaultId: vault.id, status: 'indexed' } }),
  ])

  const crossClusterEdges = edges.filter((edge) => edge.source.clusterId && edge.target.clusterId && edge.source.clusterId !== edge.target.clusterId)
  const bridgeTitles = new Set(['地址映射', '吞吐率与延迟', '学习路径规划', 'CS408 个性化资源包'])
  const bridgeCards = cards.filter((card) => bridgeTitles.has(card.title || ''))

  let profile = null
  try {
    profile = vault.profileCache ? JSON.parse(vault.profileCache) : null
  } catch {}
  const profileDimensions = profile?.dimensions ? Object.keys(profile.dimensions).length : 0

  const checks = [
    pass('vault', vault.user?.email === 'demo@axiom.space', `${vault.name} owned by ${vault.user?.email}`),
    pass('clusters', clusters.length >= 6, `${clusters.length} clusters`),
    pass('cards', cards.length >= 40, `${cards.length} cards`),
    pass('edges', edges.length >= 40, `${edges.length} edges`),
    pass('cross-cluster edges', crossClusterEdges.length >= 8, `${crossClusterEdges.length} cross-cluster edges`),
    pass('bridge cards', bridgeCards.length >= 4, `${bridgeCards.map((c) => c.title).join(', ')}`),
    pass('learning paths', paths.length >= 2, `${paths.length} paths`),
    pass('learning path steps', pathSteps.length >= 12, `${pathSteps.length} steps`),
    pass('profile dimensions', profileDimensions >= 6 && profileHistoryCount >= 1, `${profileDimensions} dimensions, ${profileHistoryCount} history rows`),
    pass('capabilities', capabilities.length >= 7, `${capabilities.length} capabilities`),
    pass('skills', skills.length >= 4, `${skills.length} skills`),
    pass('push records', pushes.length >= 2, `${pushes.length} pushes`),
    pass('memories', memories.length >= 4, `${memories.length} memories`),
    pass('agent sessions', agentSessions.length >= 1, `${agentSessions.length} agent sessions`),
    pass('rag indexes', indexedCount >= 20, `${indexedCount} indexed docs`),
  ]

  const ok = checks.every(Boolean)
  console.log(JSON.stringify({
    vaultId: vault.id,
    clusters: clusters.map((c) => c.name),
    cardTypes: cards.reduce((acc, card) => {
      acc[card.type] = (acc[card.type] || 0) + 1
      return acc
    }, {}),
    crossClusterEdges: crossClusterEdges.map((edge) => ({
      from: edge.source.title,
      to: edge.target.title,
      type: edge.type,
      fromCluster: edge.source.cluster?.name,
      toCluster: edge.target.cluster?.name,
    })).slice(0, 12),
  }, null, 2))

  process.exit(ok ? 0 : 1)
} finally {
  await prisma.$disconnect()
}
