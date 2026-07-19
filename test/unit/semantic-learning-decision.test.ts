import assert from 'node:assert/strict'
import { analyzeSemanticLearningNeed, type SemanticLearningDecisionDependencies } from '@/server/core/learning/semantic-learning-decision'

type Card = Awaited<ReturnType<SemanticLearningDecisionDependencies['loadCards']>>[number]
type Capability = Awaited<ReturnType<SemanticLearningDecisionDependencies['loadCapabilities']>>[number]

function card(input: Partial<Card> & Pick<Card, 'id' | 'title'>): Card {
  return {
    id: input.id,
    title: input.title,
    type: input.type || 'permanent',
    path: input.path || `permanent/${input.id}.md`,
    content: input.content || `# ${input.title}`,
    tags: input.tags ?? null,
  }
}

function capability(input: Partial<Capability> & Pick<Capability, 'id' | 'concept'>): Capability {
  return {
    id: input.id,
    concept: input.concept,
    masteryLevel: input.masteryLevel ?? 10,
    status: input.status || 'learning',
    weakAreas: input.weakAreas || '[]',
    strongAreas: input.strongAreas || '[]',
  }
}

function dependencies(input: {
  cards: Card[]
  capabilities: Capability[]
  references?: string[]
  assessments?: Array<{ id: string; concept: string; mastery: number }>
  judge?: SemanticLearningDecisionDependencies['judge']
}): SemanticLearningDecisionDependencies {
  return {
    queryVector: async () => ({
      enabled: true,
      answer: 'vector candidates',
      references: (input.references || []).map((cardId, index) => ({
        referenceId: String(index + 1),
        filePath: `axiom:vault:card:${cardId}`,
        cardId,
        vaultId: 'vault',
        title: input.cards.find((item) => item.id === cardId)?.title || null,
        type: input.cards.find((item) => item.id === cardId)?.type || null,
      })),
    }),
    loadCards: async () => input.cards,
    loadCapabilities: async () => input.capabilities,
    loadPassedAssessments: async () => input.assessments || [],
    judge: input.judge || (async () => ({
      equivalentCardIds: [],
      equivalentCapabilityIds: [],
      analogyCardIds: [],
      analogyCapabilityIds: [],
      confidence: 0,
      reason: '',
    })),
  }
}

async function run() {
  const visitorConcept = card({ id: 'visitor-card', title: '访问者模式', content: '# 访问者模式\n双重分派与稳定对象结构。' })
  const visitorVideo = card({
    id: 'visitor-video',
    title: '访问者模式 - 教学视频',
    type: 'literature',
    path: 'literature/visitor-video.md',
    tags: JSON.stringify(['ai-generated-resource', 'video', '访问者模式']),
    content: '<!-- axiom-resources:[{"type":"video","kind":"video","format":"html","title":"访问者模式视频","path":"resources/visitor/video.html","fileName":"video.html"}] -->',
  })
  const masteredVisitor = capability({ id: 'visitor-cap', concept: '访问者模式', masteryLevel: 91, status: 'mastered' })
  const equivalent = await analyzeSemanticLearningNeed({
    vaultId: 'vault',
    userId: 'user',
    topic: 'Visitor Pattern',
    requestedResourceKinds: ['video'],
    requestedResourceTypes: ['video'],
  }, dependencies({
    cards: [visitorConcept, visitorVideo],
    capabilities: [masteredVisitor],
    references: ['visitor-card', 'visitor-video'],
    judge: async () => ({
      equivalentCardIds: ['visitor-card', 'visitor-video'],
      equivalentCapabilityIds: ['visitor-cap'],
      analogyCardIds: [],
      analogyCapabilityIds: [],
      confidence: 0.98,
      reason: 'Visitor Pattern 是访问者模式的英文名称。',
    }),
  }))
  assert.equal(equivalent.masteryState, 'mastered')
  assert.equal(equivalent.shouldSuppressProactiveGeneration, true)
  assert.deepEqual(equivalent.coveredResourceTypes, ['video'])
  assert.equal(equivalent.canonicalConcept, '访问者模式')

  const bilingualAlias = await analyzeSemanticLearningNeed({ vaultId: 'vault', userId: 'user', topic: 'Visitor Pattern 访问者模式' }, dependencies({
    cards: [],
    capabilities: [masteredVisitor],
  }))
  assert.equal(bilingualAlias.masteryState, 'mastered')
  assert.deepEqual(bilingualAlias.equivalentCapabilityIds, ['visitor-cap'])

  const strategyCard = card({ id: 'strategy-card', title: '策略模式', content: '# 策略模式\n把可替换算法封装为对象。' })
  const strategyCapability = capability({ id: 'strategy-cap', concept: '策略模式', masteryLevel: 88, status: 'mastered' })
  const analogy = await analyzeSemanticLearningNeed({ vaultId: 'vault', userId: 'user', topic: '状态模式' }, dependencies({
    cards: [strategyCard],
    capabilities: [strategyCapability],
    references: ['strategy-card'],
    judge: async () => ({
      equivalentCardIds: [],
      equivalentCapabilityIds: [],
      analogyCardIds: ['strategy-card'],
      analogyCapabilityIds: ['strategy-cap'],
      confidence: 0.9,
      reason: '两者都委托行为，但状态转换与客户端选择不同。',
    }),
  }))
  assert.equal(analogy.masteryState, 'unknown')
  assert.equal(analogy.shouldSuppressProactiveGeneration, false)
  assert.deepEqual(analogy.analogies.map((item) => item.concept), ['策略模式'])
  assert.match(analogy.promptContext, /相同机制.*关键差异/)

  const safeFallback = await analyzeSemanticLearningNeed({ vaultId: 'vault', userId: 'user', topic: '观察者模式' }, dependencies({
    cards: [strategyCard],
    capabilities: [strategyCapability],
    references: ['strategy-card'],
    judge: async () => { throw new Error('judge offline') },
  }))
  assert.deepEqual(safeFallback.equivalentCardIds, [])
  assert.equal(safeFallback.shouldSuppressProactiveGeneration, false)
  assert.deepEqual(safeFallback.analogies.map((item) => item.concept), ['策略模式'])

  const assessed = await analyzeSemanticLearningNeed({ vaultId: 'vault', userId: 'user', topic: 'Visitor 双分派' }, dependencies({
    cards: [visitorConcept],
    capabilities: [capability({ id: 'visitor-learning', concept: '访问者模式', masteryLevel: 45 })],
    references: ['visitor-card'],
    assessments: [{ id: 'assessment-1', concept: '访问者模式', mastery: 93 }],
    judge: async () => ({
      equivalentCardIds: ['visitor-card'],
      equivalentCapabilityIds: ['visitor-learning'],
      analogyCardIds: [],
      analogyCapabilityIds: [],
      confidence: 0.94,
      reason: '当前任务指向同一个双重分派学习目标。',
    }),
  }))
  assert.equal(assessed.masteryState, 'mastered')
  assert.match(assessed.masteryEvidence.join(' '), /通过测验/)

  console.log('semantic-learning-decision: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
