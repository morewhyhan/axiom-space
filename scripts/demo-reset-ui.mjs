import crypto from 'node:crypto'
import { PrismaClient } from '../node_modules/.pnpm/@prisma+client@6.19.2_prisma@6.19.2_typescript@5.6.2__typescript@5.6.2/node_modules/@prisma/client/default.js'

const prisma = new PrismaClient()

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(Buffer.from(derivedKey).toString('hex'))
    })
  })
  return `${salt}:${key}`
}

function daysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(10 + (days % 8), (days * 13) % 60, 0, 0)
  return d
}

function isoDaysAgo(days) {
  return daysAgo(days).toISOString()
}

async function upsertDemoUser(email, name, password) {
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, emailVerified: true },
    create: { email, name, emailVerified: true },
  })

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })

  if (!account) {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: email,
        providerId: 'credential',
        password: await hashPassword(password),
      },
    })
  }

  return user
}

async function ensureVault(userId, name) {
  const vault = await prisma.vault.findFirst({
    where: { userId, name },
  })

  if (vault) return vault

  return prisma.vault.create({
    data: { userId, name },
  })
}

async function resetVaultGraph(vaultId, userId) {
  await prisma.$transaction([
    prisma.agentConfirmationToken.deleteMany({ where: { vaultId } }),
    prisma.agentAuditLog.deleteMany({ where: { vaultId } }),
    prisma.domainEvent.deleteMany({ where: { vaultId } }),
    prisma.promotionAttempt.deleteMany({ where: { vaultId } }),
    prisma.assessmentResult.deleteMany({ where: { vaultId } }),
    prisma.cardRevision.deleteMany({ where: { vaultId } }),
    prisma.notificationReceipt.deleteMany({ where: { vaultId } }),
    prisma.resourceGenerationJob.deleteMany({ where: { vaultId } }),
    prisma.sourceDocumentChunk.deleteMany({ where: { sourceDocument: { is: { vaultId } } } }),
    prisma.sourceDocument.deleteMany({ where: { vaultId } }),
    prisma.ragDocumentIndex.deleteMany({ where: { vaultId } }),
    prisma.pushRecord.deleteMany({ where: { OR: [{ vaultId }, { userId, vaultId: null }] } }),
    prisma.edge.deleteMany({ where: { vaultId } }),
    prisma.pathAdjustmentHistory.deleteMany({ where: { path: { vaultId } } }),
    prisma.learningPathStep.deleteMany({ where: { path: { vaultId } } }),
    prisma.learningPath.deleteMany({ where: { vaultId } }),
    prisma.learningSession.deleteMany({ where: { vaultId } }),
    prisma.agentSession.deleteMany({ where: { vaultId } }),
    prisma.vaultMemory.deleteMany({ where: { vaultId } }),
    prisma.vaultCapability.deleteMany({ where: { vaultId } }),
    prisma.vaultSkill.deleteMany({ where: { vaultId } }),
    prisma.educationProfileHistory.deleteMany({ where: { vaultId } }),
    prisma.cluster.deleteMany({ where: { vaultId } }),
    prisma.card.deleteMany({ where: { vaultId } }),
  ])
}

function cardBody(title, topic, kind, related) {
  const links = related.length > 0 ? `\n\nRelated: ${related.map((r) => `[[${r}]]`).join(', ')}` : ''
  return `# ${title}\n\nTopic: ${topic}\nType: ${kind}${links}\n`
}

async function seedVault(vaultId) {
  const userId = (await prisma.vault.findUnique({ where: { id: vaultId }, select: { userId: true } })).userId

  const clusters = [
    { name: 'Data Structures', color: '#a855f7', position: 0 },
    { name: 'Architecture', color: '#22d3ee', position: 1 },
    { name: 'Operating Systems', color: '#f472b6', position: 2 },
    { name: 'Networking', color: '#818cf8', position: 3 },
  ]

  const clusterRows = new Map()
  for (const c of clusters) {
    const row = await prisma.cluster.create({
      data: { vaultId, name: c.name, color: c.color, position: c.position },
    })
    clusterRows.set(c.name, row)
  }

  const cardDefs = [
    { cluster: 'Data Structures', title: 'linked-list', path: 'data-structures/linked-list.md', type: 'permanent', tags: ['list', 'linear'], related: ['stack', 'graph'], createdAt: daysAgo(8) },
    { cluster: 'Data Structures', title: 'stack', path: 'data-structures/stack.md', type: 'permanent', tags: ['stack'], related: ['linked-list'], createdAt: daysAgo(7) },
    { cluster: 'Data Structures', title: 'graph', path: 'data-structures/graph.md', type: 'permanent', tags: ['graph'], related: ['shortest-path', 'topological-sort'], createdAt: daysAgo(6) },
    { cluster: 'Data Structures', title: 'shortest-path', path: 'data-structures/shortest-path.md', type: 'fleeting', tags: ['graph', 'path'], related: ['graph'], createdAt: daysAgo(2) },
    { cluster: 'Data Structures', title: 'topological-sort', path: 'data-structures/topological-sort.md', type: 'fleeting', tags: ['graph', 'order'], related: ['graph'], createdAt: daysAgo(1) },
    { cluster: 'Data Structures', title: 'LeetCode HOT100', path: 'data-structures/leetcode-hot100.md', type: 'literature', tags: ['practice'], related: ['graph', 'stack'], createdAt: daysAgo(12) },
    { cluster: 'Architecture', title: 'pipeline', path: 'architecture/pipeline.md', type: 'permanent', tags: ['cpu'], related: ['cache', 'virtual-memory'], createdAt: daysAgo(10) },
    { cluster: 'Architecture', title: 'cache', path: 'architecture/cache.md', type: 'permanent', tags: ['cache'], related: ['pipeline'], createdAt: daysAgo(9) },
    { cluster: 'Architecture', title: 'Amdahl law', path: 'architecture/amdahl-law.md', type: 'fleeting', tags: ['performance'], related: ['pipeline', 'cache'], createdAt: daysAgo(4) },
    { cluster: 'Architecture', title: 'computer architecture notes', path: 'architecture/notes.md', type: 'literature', tags: ['textbook'], related: ['pipeline', 'cache'], createdAt: daysAgo(13) },
    { cluster: 'Operating Systems', title: 'virtual-memory', path: 'operating-systems/virtual-memory.md', type: 'permanent', tags: ['memory'], related: ['page-fault', 'page-replacement'], createdAt: daysAgo(5) },
    { cluster: 'Operating Systems', title: 'page-fault', path: 'operating-systems/page-fault.md', type: 'fleeting', tags: ['memory'], related: ['virtual-memory'], createdAt: daysAgo(3) },
    { cluster: 'Operating Systems', title: 'page-replacement', path: 'operating-systems/page-replacement.md', type: 'fleeting', tags: ['memory'], related: ['virtual-memory'], createdAt: daysAgo(2) },
    { cluster: 'Operating Systems', title: 'operating-systems textbook', path: 'operating-systems/textbook.md', type: 'literature', tags: ['textbook'], related: ['virtual-memory'], createdAt: daysAgo(15) },
    { cluster: 'Networking', title: 'tcp-reliability', path: 'networking/tcp-reliability.md', type: 'permanent', tags: ['tcp'], related: ['dns', 'congestion-control'], createdAt: daysAgo(11) },
    { cluster: 'Networking', title: 'dns', path: 'networking/dns.md', type: 'permanent', tags: ['dns'], related: ['tcp-reliability'], createdAt: daysAgo(4) },
    { cluster: 'Networking', title: 'congestion-control', path: 'networking/congestion-control.md', type: 'fleeting', tags: ['tcp'], related: ['tcp-reliability'], createdAt: daysAgo(2) },
    { cluster: 'Networking', title: 'networking guide', path: 'networking/guide.md', type: 'literature', tags: ['guide'], related: ['tcp-reliability', 'dns'], createdAt: daysAgo(14) },
  ]

  const cardRows = new Map()
  for (const card of cardDefs) {
    const cluster = clusterRows.get(card.cluster)
    if (!cluster) continue
    const row = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        title: card.title,
        path: card.path,
        type: card.type,
        tags: JSON.stringify(card.tags),
        content: cardBody(card.title, card.cluster, card.type, card.related),
        createdAt: card.createdAt,
      },
    })
    cardRows.set(card.title, { id: row.id })
  }

  const edges = [
    ['graph', 'shortest-path', 'related'],
    ['graph', 'topological-sort', 'related'],
    ['stack', 'linked-list', 'related'],
    ['pipeline', 'cache', 'related'],
    ['pipeline', 'virtual-memory', 'prerequisite'],
    ['tcp-reliability', 'dns', 'related'],
    ['virtual-memory', 'page-fault', 'related'],
    ['virtual-memory', 'page-replacement', 'related'],
  ]

  for (const [sourceTitle, targetTitle, type] of edges) {
    const source = cardRows.get(sourceTitle)
    const target = cardRows.get(targetTitle)
    if (!source || !target) continue
    await prisma.edge.create({
      data: {
        vaultId,
        sourceId: source.id,
        targetId: target.id,
        type,
        weight: 1,
      },
    })
  }

  const path1 = await prisma.learningPath.create({
    data: {
      userId,
      vaultId,
      name: 'CS408 Core Graph',
      topic: 'CS408',
      description: 'Primary demo path.',
      difficulty: 'intermediate',
      totalSteps: 5,
      doneSteps: 2,
      status: 'active',
      source: 'graph',
    },
  })

  const path1Steps = [
    { title: 'linked-list', status: 'mastered', mastery: 95 },
    { title: 'stack', status: 'completed', mastery: 82 },
    { title: 'graph', status: 'learning', mastery: 54 },
    { title: 'shortest-path', status: 'available', mastery: 18 },
    { title: 'topological-sort', status: 'locked', mastery: 0 },
  ]

  for (let i = 0; i < path1Steps.length; i++) {
    const s = path1Steps[i]
    const card = cardRows.get(s.title)
    await prisma.learningPathStep.create({
      data: {
        pathId: path1.id,
        cardId: card?.id ?? null,
        order: i + 1,
        title: s.title,
        description: s.title,
        concept: s.title,
        chapter: i < 2 ? 'Foundations' : 'Graph Focus',
        status: s.status,
        mastery: s.mastery,
        estimatedMinutes: 20 + i * 5,
        prerequisites: i > 0 ? JSON.stringify([`${path1.id}-step-${i}`]) : JSON.stringify([]),
      },
    })
  }

  const path2 = await prisma.learningPath.create({
    data: {
      userId,
      vaultId,
      name: 'Systems Review Track',
      topic: 'Systems Review',
      description: 'Cross-domain demo path.',
      difficulty: 'advanced',
      totalSteps: 4,
      doneSteps: 1,
      status: 'active',
      source: 'ai',
    },
  })

  const path2Steps = [
    { title: 'pipeline', status: 'completed', mastery: 76 },
    { title: 'virtual-memory', status: 'available', mastery: 42 },
    { title: 'tcp-reliability', status: 'learning', mastery: 60 },
    { title: 'dns', status: 'locked', mastery: 0 },
  ]

  for (let i = 0; i < path2Steps.length; i++) {
    const s = path2Steps[i]
    const card = cardRows.get(s.title)
    await prisma.learningPathStep.create({
      data: {
        pathId: path2.id,
        cardId: card?.id ?? null,
        order: i + 1,
        title: s.title,
        description: s.title,
        concept: s.title,
        chapter: i < 2 ? 'Systems' : 'Networking',
        status: s.status,
        mastery: s.mastery,
        estimatedMinutes: 15 + i * 6,
        prerequisites: i > 0 ? JSON.stringify([`${path2.id}-step-${i}`]) : JSON.stringify([]),
      },
    })
  }

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: path1.id,
      trigger: 'assessment_failed',
      adjustment: JSON.stringify({
        type: 'add_review',
        concept: 'graph',
        description: 'Add a shortest-path review step.',
      }),
      feedback: JSON.stringify({ feedbackText: 'Need one more pass on shortest paths.' }),
      appliedAt: daysAgo(2),
    },
  })

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: path2.id,
      trigger: 'assessment_excellent',
      adjustment: JSON.stringify({
        type: 'skip_ahead',
        concept: 'pipeline',
        description: 'Move ahead faster on foundation systems topics.',
      }),
      feedback: JSON.stringify({ feedbackText: 'Foundations feel stable.' }),
      appliedAt: daysAgo(1),
    },
  })

  const profile = {
    userId,
    dimensions: {
      depth: { score: 76, confidence: 0.82, evidence: ['High permanent-card ratio', 'Explains graph tradeoffs'] },
      breadth: { score: 68, confidence: 0.77, evidence: ['Four core clusters', 'Cross-domain links'] },
      connection: { score: 71, confidence: 0.79, evidence: ['Multi-cluster edges exist', 'Systems links are visible'] },
      expression: { score: 74, confidence: 0.7, evidence: ['Clear observations', 'Concrete examples in sessions'] },
      application: { score: 62, confidence: 0.66, evidence: ['Practice is improving', 'Push records reinforce weak spots'] },
      learning_pace: { score: 69, confidence: 0.74, evidence: ['Recent weekly activity', 'Cadence is steady'] },
    },
    updateHistory: [
      {
        timestamp: Date.now() - 4 * 24 * 60 * 60 * 1000,
        trigger: 'manual',
        dimensionsUpdated: ['depth', 'expression'],
        changes: { depth: { before: 69, after: 73 }, expression: { before: 67, after: 71 } },
      },
      {
        timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
        trigger: 'assessment',
        dimensionsUpdated: ['application', 'connection'],
        changes: { application: { before: 56, after: 62 }, connection: { before: 66, after: 71 } },
      },
      {
        timestamp: Date.now() - 6 * 60 * 60 * 1000,
        trigger: 'session_end',
        dimensionsUpdated: ['learning_pace'],
        changes: { learning_pace: { before: 64, after: 69 } },
      },
    ],
    sessionCount: 3,
    totalLearningMinutes: 106,
    createdAt: Date.now() - 21 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 6 * 60 * 60 * 1000,
  }

  await prisma.educationProfileHistory.create({
    data: {
      vaultId,
      profile: JSON.stringify(profile),
      snapshot: JSON.stringify({ averageScore: 70 }),
      createdAt: daysAgo(1),
    },
  })

  const pushRecord = [
    {
      trigger: 'assessment_failed',
      reason: 'Weak shortest-path performance triggered extra review resources.',
      viewedAt: null,
      engagedCount: 0,
      feedback: null,
      resources: [
        { resourceId: 'push-review-graph', type: 'quiz', title: 'Shortest Path Drill Set', content: 'Compare Dijkstra, Floyd, and Bellman-Ford.' },
        { resourceId: 'push-review-note', type: 'document', title: 'Graph Quick Notes', content: 'Compact review sheet for prerequisites and mistakes.' },
      ],
    },
    {
      trigger: 'stage_completion',
      reason: 'Strong fundamentals unlocked an integrated systems bundle.',
      viewedAt: daysAgo(1),
      engagedCount: 2,
      feedback: { engagedResourceIds: ['push-advance-systems'], feedbackText: 'Useful mixed practice.' },
      resources: [
        { resourceId: 'push-advance-systems', type: 'code', title: 'OS / Memory / Cache Mixed Practice', content: 'Engineering-flavored exercise bundle.' },
        { resourceId: 'push-advance-diagram', type: 'diagram', title: 'Virtual-to-Physical Address Flow', content: 'Pairs nicely with Galaxy and Cognition.' },
      ],
    },
  ]

  for (const p of pushRecord) {
    await prisma.pushRecord.create({
      data: {
        userId,
        vaultId,
        resources: JSON.stringify(p.resources),
        trigger: p.trigger,
        reason: p.reason,
        sentAt: daysAgo(p.viewedAt ? 1 : 3),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        viewedAt: p.viewedAt,
        engagedCount: p.engagedCount,
        feedback: p.feedback ? JSON.stringify(p.feedback) : null,
      },
    })
  }

  const obs = [
    'The user compares related concepts well.',
    'Systems topics are becoming a stronger interest.',
    'Graph tradeoffs still need one more repetition.',
    'Learn mode benefits from explicit next steps.',
    'The weekly cadence is steady enough to feel alive.',
  ]

  for (const text of obs) {
    await prisma.vaultMemory.create({
      data: {
        vaultId,
        key: `obs_${Math.random().toString(36).slice(2, 8)}`,
        value: JSON.stringify({ text, category: 'general' }),
        category: 'observation',
        createdAt: daysAgo(2),
      },
    })
  }

  await prisma.agentSession.create({
    data: {
      id: `seed-agent-${vaultId.slice(0, 8)}`,
      vaultId,
      name: 'CS408 Review Thread',
      messages: JSON.stringify([
        { id: 'm1', role: 'system', content: 'You are helping the user review topics inside the current vault.', timestamp: isoDaysAgo(2) },
        { id: 'm2', role: 'user', content: 'Help me connect OS memory management with cache behavior and address translation.', timestamp: isoDaysAgo(2) },
        { id: 'm3', role: 'assistant', content: 'We can look at translation, locality, page replacement, and access patterns.', timestamp: isoDaysAgo(2) },
      ]),
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  })

  await prisma.vault.update({
    where: { id: vaultId },
    data: { profileCache: null },
  })
}

async function main() {
  const email = 'demo@axiom.space'
  const password = 'demo123456'
  const user = await upsertDemoUser(email, 'Demo User', password)

  const mainVault = await ensureVault(user.id, 'Demo Vault')
  const sideVault = await ensureVault(user.id, 'Side Vault')

  await resetVaultGraph(mainVault.id, user.id)
  await resetVaultGraph(sideVault.id, user.id)

  await seedVault(mainVault.id)
  await seedVault(sideVault.id)

  console.log('Demo reset complete:')
  console.log(`- user: ${email}`)
  console.log(`- main vault: ${mainVault.name}`)
  console.log(`- side vault: ${sideVault.name}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
