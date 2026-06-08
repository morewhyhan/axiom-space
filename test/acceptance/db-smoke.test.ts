import assert from 'node:assert/strict'
import test from 'node:test'
import { prisma } from '@/lib/db'

const runId = `sdd-real-${Date.now()}-${Math.random().toString(36).slice(2)}`

test('real DB enforces user/vault/card/path/edge/session ownership contracts', async () => {
  const user = await prisma.user.create({
    data: {
      email: `${runId}@example.com`,
      name: 'SDD Real Test User',
      vaults: {
        create: {
          name: 'SDD Real Vault',
        },
      },
    },
    include: { vaults: true },
  })
  const vault = user.vaults[0]

  const source = await prisma.card.create({
    data: {
      vaultId: vault.id,
      path: 'source.md',
      title: 'Source',
      content: '# Source\n\n[[Target]]',
      type: 'fleeting',
    },
  })
  const target = await prisma.card.create({
    data: {
      vaultId: vault.id,
      path: 'target.md',
      title: 'Target',
      content: '# Target',
      type: 'permanent',
    },
  })
  const edge = await prisma.edge.create({
    data: {
      vaultId: vault.id,
      sourceId: source.id,
      targetId: target.id,
      type: 'wikilink',
      weight: 1,
    },
  })
  const path = await prisma.learningPath.create({
    data: {
      userId: user.id,
      vaultId: vault.id,
      name: 'SDD Path',
      topic: '第一性原理',
      totalSteps: 1,
      steps: {
        create: {
          order: 1,
          title: 'Step 1',
          concept: '第一性原理',
          cardId: source.id,
          status: 'available',
        },
      },
    },
    include: { steps: true },
  })
  const session = await prisma.learningSession.create({
    data: {
      userId: user.id,
      vaultId: vault.id,
      domain: '__agent__',
      concept: '第一性原理',
      status: 'active',
      metadata: JSON.stringify({
        cardId: source.id,
        pathId: path.id,
        stepId: path.steps[0].id,
        threadStatus: 'active',
      }),
      messages: {
        create: {
          role: 'user',
          content: '我用自己的话解释一下。',
        },
      },
    },
    include: { messages: true },
  })

  assert.equal(vault.userId, user.id)
  assert.equal(source.vaultId, vault.id)
  assert.equal(target.vaultId, vault.id)
  assert.equal(edge.vaultId, vault.id)
  assert.equal(edge.sourceId, source.id)
  assert.equal(edge.targetId, target.id)
  assert.equal(path.userId, user.id)
  assert.equal(path.vaultId, vault.id)
  assert.equal(path.steps.length, 1)
  assert.equal(path.steps[0].cardId, source.id)
  assert.equal(session.userId, user.id)
  assert.equal(session.vaultId, vault.id)
  assert.equal(session.messages[0].sessionId, session.id)

  const metadata = JSON.parse(session.metadata ?? '{}') as Record<string, unknown>
  assert.equal(metadata.cardId, source.id)
  assert.equal(metadata.pathId, path.id)
  assert.equal(metadata.stepId, path.steps[0].id)

  await assert.rejects(
    prisma.card.create({
      data: {
        vaultId: vault.id,
        path: 'source.md',
        title: 'Duplicate Path',
        content: '# Duplicate',
        type: 'fleeting',
      },
    }),
  )

  await prisma.user.delete({ where: { id: user.id } })
})
