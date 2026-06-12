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
    learningSessions,
    agentSessions,
    indexedCount,
    pathAdjustmentsCount,
    assessmentResultsCount,
    sourceDocumentCount,
    resourceJobs,
    domainEvents,
  ] = await Promise.all([
    prisma.cluster.findMany({ where: { vaultId: vault.id }, orderBy: { position: 'asc' } }),
    prisma.card.findMany({ where: { vaultId: vault.id }, include: { cluster: true } }),
    prisma.edge.findMany({ where: { vaultId: vault.id }, include: { source: { include: { cluster: true } }, target: { include: { cluster: true } } } }),
    prisma.learningPath.findMany({ where: { vaultId: vault.id } }),
    prisma.learningPathStep.findMany({ where: { path: { vaultId: vault.id } } }),
    prisma.educationProfileHistory.count({ where: { vaultId: vault.id } }),
    prisma.vaultCapability.findMany({ where: { vaultId: vault.id } }),
    prisma.vaultSkill.findMany({ where: { vaultId: vault.id } }),
    prisma.pushRecord.findMany({ where: { vaultId: vault.id } }),
    prisma.vaultMemory.findMany({ where: { vaultId: vault.id } }),
    prisma.learningSession.findMany({ where: { vaultId: vault.id } }),
    prisma.agentSession.findMany({ where: { vaultId: vault.id } }),
    prisma.ragDocumentIndex.count({ where: { vaultId: vault.id, status: 'indexed' } }),
    prisma.pathAdjustmentHistory.count({ where: { path: { vaultId: vault.id } } }),
    prisma.assessmentResult.count({ where: { vaultId: vault.id } }),
    prisma.sourceDocument.count({ where: { vaultId: vault.id } }),
    prisma.resourceGenerationJob.findMany({ where: { vaultId: vault.id } }),
    prisma.domainEvent.findMany({ where: { vaultId: vault.id } }),
  ])

  const cardTypes = cards.reduce((acc, card) => {
    acc[card.type] = (acc[card.type] || 0) + 1
    return acc
  }, {})

  const crossClusterEdges = edges.filter((edge) => edge.source.clusterId && edge.target.clusterId && edge.source.clusterId !== edge.target.clusterId)
  const rootCard = cards.find((card) => card.path === '__root__.md')
  const containsEdges = edges.filter((edge) => edge.type === 'contains')
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const childrenByParent = new Map()
  for (const edge of containsEdges) {
    childrenByParent.set(edge.sourceId, [...(childrenByParent.get(edge.sourceId) || []), edge.targetId])
  }
  const depthById = new Map()
  const queue = rootCard ? [{ id: rootCard.id, depth: 0 }] : []
  if (rootCard) depthById.set(rootCard.id, 0)
  while (queue.length > 0) {
    const current = queue.shift()
    for (const childId of childrenByParent.get(current.id) || []) {
      if (depthById.has(childId)) continue
      depthById.set(childId, current.depth + 1)
      queue.push({ id: childId, depth: current.depth + 1 })
    }
  }

  const expectedRootChildren = ['操作系统', '数据结构', '计算机网络', '计算机组成原理'].sort()
  const rootChildTitles = (rootCard ? childrenByParent.get(rootCard.id) || [] : [])
    .map((id) => cardById.get(id)?.title)
    .filter(Boolean)
    .sort()
  const clusterNames = clusters.map((cluster) => cluster.name).sort()
  const maxDepth = Math.max(...Array.from(depthById.values()), 0)
  const deepCards = cards.filter((card) => (depthById.get(card.id) ?? 0) >= 3)
  const sourceMaterialTitles = [
    'CS408 数据结构复习资料',
    'CS408 计算机组成原理复习资料',
    'CS408 操作系统复习资料',
    'CS408 计算机网络复习资料',
  ]
  const sourceMaterialCards = sourceMaterialTitles.map((title) => cards.find((card) => card.title === title))
  const sourceMaterialsAreReadable = sourceMaterialCards.every((card) =>
    card?.type === 'literature' &&
    (card.content?.length ?? 0) > 1800 &&
    card.content.includes('## 课程定位') &&
    card.content.includes('## 可拆解概念'),
  )
  const resourcePack = cards.find((card) => card.title === 'CS408 图算法个性化资源包')
  const excludedDemoTitles = new Set(['学习路径规划', 'CS408 个性化资源包', '图算法评估记录'])
  const excludedDemoCards = cards.filter((card) => excludedDemoTitles.has(card.title || ''))
  const scaffoldLeafCards = cards.filter((card) => card.path !== '__root__.md' && !card.path.endsWith('/__index__.md') && card.type === 'fleeting')
  const bridgeTitles = new Set(['地址映射', '吞吐率与延迟'])
  const bridgeCards = cards.filter((card) => bridgeTitles.has(card.title || ''))
  const observations = memories.filter((memory) => memory.category === 'observation')
  const readyResourceJobs = resourceJobs.filter((job) => job.status === 'ready' && job.progress === 100)
  const allStepStatuses = new Set(pathSteps.map((step) => step.status))
  const pathDoneOk = paths.some((path) => path.doneSteps > 0) && paths.every((path) => {
    const done = pathSteps.filter((step) => step.pathId === path.id && ['completed', 'mastered'].includes(step.status)).length
    return done === path.doneSteps
  })

  let profile = null
  try {
    profile = vault.profileCache ? JSON.parse(vault.profileCache) : null
  } catch {}
  const profileDimensions = profile?.dimensions ? Object.keys(profile.dimensions).length : 0

  const checks = [
    pass('vault', vault.user?.email === 'demo@axiom.space', `${vault.name} owned by ${vault.user?.email}`),
    pass('course clusters', JSON.stringify(clusterNames) === JSON.stringify(expectedRootChildren), `${clusters.length} clusters: ${clusterNames.join(', ')}`),
    pass('no resource pseudo-clusters', !clusterNames.includes('跨域综合') && !clusterNames.includes('资源与评估') && !clusterNames.includes('导入资料'), `${clusterNames.join(', ')}`),
    pass('cards', cards.length >= 70, `${cards.length} cards`),
    pass('card type mix', (cardTypes.permanent || 0) >= 30 && (cardTypes.fleeting || 0) >= 20 && (cardTypes.literature || 0) >= 10, JSON.stringify(cardTypes)),
    pass('edges', edges.length >= 120, `${edges.length} edges`),
    pass('root concept card', !!rootCard, rootCard?.title || 'missing'),
    pass('root course children', JSON.stringify(rootChildTitles) === JSON.stringify(expectedRootChildren), rootChildTitles.join(', ')),
    pass('deep contains hierarchy', containsEdges.length >= 70 && maxDepth >= 4 && deepCards.length >= 40, `${containsEdges.length} contains edges, maxDepth=${maxDepth}, deepCards=${deepCards.length}`),
    pass('cross-cluster edges', crossClusterEdges.length >= 6, `${crossClusterEdges.length} cross-cluster edges`),
    pass('bridge cards', bridgeCards.length >= 2, `${bridgeCards.map((c) => c.title).join(', ')}`),
    pass('source materials', sourceMaterialsAreReadable && sourceDocumentCount >= 4, `${sourceMaterialCards.filter(Boolean).length} material cards, ${sourceDocumentCount} source docs, lengths=${sourceMaterialCards.map((card) => card?.content?.length || 0).join('/')}`),
    pass('resource pack', !!resourcePack && resourcePack.content.includes('axiom-resources') && readyResourceJobs.length >= 6, `${resourcePack?.title || 'missing'}, jobs=${readyResourceJobs.length}`),
    pass('no old pseudo demo cards', excludedDemoCards.length === 0, excludedDemoCards.map((card) => card.title).join(', ') || 'none'),
    pass('task scaffold content', scaffoldLeafCards.length >= 4 && scaffoldLeafCards.every((card) => card.content.includes('## 待填写')), `${scaffoldLeafCards.length} scaffold leaf cards`),
    pass('learning paths', paths.length === 4, `${paths.length} paths`),
    pass('learning path steps', pathSteps.length >= 30, `${pathSteps.length} steps`),
    pass('mixed path statuses', ['mastered', 'completed', 'learning', 'available', 'locked'].every((status) => allStepStatuses.has(status)), Array.from(allStepStatuses).join(', ')),
    pass('path progress', pathDoneOk, paths.map((path) => `${path.name}:${path.doneSteps}/${path.totalSteps}`).join(', ')),
    pass('profile dimensions', profileDimensions >= 6 && profileHistoryCount >= 1, `${profileDimensions} dimensions, ${profileHistoryCount} history rows`),
    pass('capabilities', capabilities.length >= 8, `${capabilities.length} capabilities`),
    pass('skills', skills.length >= 4, `${skills.length} skills`),
    pass('push records', pushes.length >= 2, `${pushes.length} pushes`),
    pass('observations', observations.length >= 2, `${observations.length} observations, ${memories.length} memories`),
    pass('sessions', learningSessions.length >= 1 && agentSessions.length >= 1, `${learningSessions.length} learning sessions, ${agentSessions.length} agent sessions`),
    pass('rag indexes', indexedCount >= 35, `${indexedCount} indexed docs`),
    pass('assessments and adjustments', assessmentResultsCount >= 1 && pathAdjustmentsCount >= 2, `${assessmentResultsCount} assessments, ${pathAdjustmentsCount} path adjustments`),
    pass('domain events', domainEvents.length >= 5, `${domainEvents.length} events`),
  ]

  const ok = checks.every(Boolean)
  console.log(JSON.stringify({
    vaultId: vault.id,
    clusters: clusters.map((c) => c.name),
    rootChildren: rootChildTitles,
    maxDepth,
    deepCards: deepCards.length,
    cardTypes,
    sourceMaterials: sourceMaterialCards.map((card) => ({ title: card?.title, cluster: card?.cluster?.name, type: card?.type })),
    resourceJobs: readyResourceJobs.map((job) => `${job.resourceType}:${job.status}`),
    pathStatuses: Array.from(allStepStatuses),
    crossClusterEdges: crossClusterEdges.map((edge) => ({
      from: edge.source.title,
      to: edge.target.title,
      type: edge.type,
      fromCluster: edge.source.cluster?.name,
      toCluster: edge.target.cluster?.name,
    })).slice(0, 12),
    containsEdges: containsEdges.length,
  }, null, 2))

  process.exit(ok ? 0 : 1)
} finally {
  await prisma.$disconnect()
}
