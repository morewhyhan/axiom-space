import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { ROOT_CARD_PATH } from '@/server/core/domain/concept-graph'

const prisma = new PrismaClient()
const vaultId = 'a3-cap-import-proof-vault-20260718'
const expected = process.env.A3_IMPORT_PROOF_EXPECT || process.argv[2] || 'either'

async function main() {
  const [cards, edges, paths, documents] = await Promise.all([
    prisma.card.findMany({
      where: { vaultId },
      select: { title: true, type: true, path: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.edge.count({ where: { vaultId } }),
    prisma.learningPath.count({ where: { vaultId } }),
    prisma.sourceDocument.count({ where: { vaultId } }),
  ])

  const visibleCards = cards.filter((card) => card.path !== ROOT_CARD_PATH)
  const result = {
    vaultId,
    stage: visibleCards.length === 0 ? 'before' : 'after',
    visibleCards: visibleCards.length,
    internalCards: cards.length,
    permanent: visibleCards.filter((card) => card.type === 'permanent').length,
    fleeting: visibleCards.filter((card) => card.type === 'fleeting').length,
    literature: visibleCards.filter((card) => card.type === 'literature').length,
    edges,
    paths,
    documents,
    titles: visibleCards,
  }

  assert(['before', 'after', 'either'].includes(expected), `Unknown expected stage: ${expected}`)
  if (expected === 'before') {
    assert.deepEqual(
      { visibleCards: result.visibleCards, edges, paths, documents },
      { visibleCards: 0, edges: 0, paths: 0, documents: 0 },
      'Import proof is not at the clean 0-node starting state',
    )
  }
  if (expected === 'after') {
    assert(result.visibleCards >= 12, 'Import proof must create a meaningful set of visible knowledge nodes')
    assert(result.fleeting >= 10, 'Import proof must create learnable knowledge nodes')
    assert.equal(result.literature, 1, 'Import proof must preserve the imported file as one literature card')
    assert(edges >= result.visibleCards - 1, 'Import proof must connect the generated hierarchy')
    assert.equal(paths, 1, 'Import proof must create one learning path')
    assert.equal(documents, 1, 'Import proof must retain one source document')
  }

  console.log(JSON.stringify({ expected, ...result }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
