import assert from 'node:assert/strict'
import test from 'node:test'
import { prisma } from '@/lib/db'

const runId = `sdd-db-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`

test('real DB enforces scoped uniqueness and cascade contracts', async (t) => {
  await t.test('card paths are unique inside one vault but reusable across vaults', async () => {
    const { userA, userB, vaultA, vaultB } = await createUsersAndVaults('card-path')

    await prisma.card.create({
      data: {
        vaultId: vaultA.id,
        path: 'shared.md',
        title: 'Shared A',
        content: '# A',
        type: 'fleeting',
      },
    })

    await assert.rejects(
      prisma.card.create({
        data: {
          vaultId: vaultA.id,
          path: 'shared.md',
          title: 'Duplicate A',
          content: '# Duplicate',
          type: 'fleeting',
        },
      }),
    )

    const samePathOtherVault = await prisma.card.create({
      data: {
        vaultId: vaultB.id,
        path: 'shared.md',
        title: 'Shared B',
        content: '# B',
        type: 'fleeting',
      },
    })
    assert.equal(samePathOtherVault.vaultId, vaultB.id)

    await cleanupUsers(userA.id, userB.id)
  })

  await t.test('deleting a card removes graph edges that point to it', async () => {
    const { userA, vaultA } = await createUsersAndVaults('edge-cascade')
    const source = await createCard(vaultA.id, 'source.md', 'Source')
    const target = await createCard(vaultA.id, 'target.md', 'Target')
    const edge = await prisma.edge.create({
      data: {
        vaultId: vaultA.id,
        sourceId: source.id,
        targetId: target.id,
        type: 'wikilink',
      },
    })

    await prisma.card.delete({ where: { id: target.id } })
    assert.equal(await prisma.edge.count({ where: { id: edge.id } }), 0)

    await cleanupUsers(userA.id)
  })

  await t.test('deleting a user cascades through vault-owned learning and graph objects', async () => {
    const { userA, vaultA } = await createUsersAndVaults('user-cascade')
    const card = await createCard(vaultA.id, 'card.md', 'Card')
    const path = await prisma.learningPath.create({
      data: {
        userId: userA.id,
        vaultId: vaultA.id,
        name: 'Cascade Path',
        topic: 'Cascade',
        steps: {
          create: {
            order: 1,
            title: 'Cascade Step',
            concept: 'Cascade',
            cardId: card.id,
          },
        },
      },
      include: { steps: true },
    })
    const session = await prisma.learningSession.create({
      data: {
        userId: userA.id,
        vaultId: vaultA.id,
        domain: '__agent__',
        concept: 'Cascade',
        messages: {
          create: {
            role: 'user',
            content: 'hello',
          },
        },
      },
      include: { messages: true },
    })
    const rag = await prisma.ragDocumentIndex.create({
      data: {
        vaultId: vaultA.id,
        cardId: card.id,
        workspace: `workspace-${runId}`,
        documentId: `doc-${runId}`,
        contentHash: 'hash-a',
        status: 'indexed',
      },
    })

    await prisma.user.delete({ where: { id: userA.id } })

    assert.equal(await prisma.vault.count({ where: { id: vaultA.id } }), 0)
    assert.equal(await prisma.card.count({ where: { id: card.id } }), 0)
    assert.equal(await prisma.learningPath.count({ where: { id: path.id } }), 0)
    assert.equal(await prisma.learningPathStep.count({ where: { id: path.steps[0].id } }), 0)
    assert.equal(await prisma.learningSession.count({ where: { id: session.id } }), 0)
    assert.equal(await prisma.learningMessage.count({ where: { id: session.messages[0].id } }), 0)
    assert.equal(await prisma.ragDocumentIndex.count({ where: { id: rag.id } }), 0)
  })

  await t.test('RAG indexes are idempotent per provider/card and provider/document', async () => {
    const { userA, vaultA } = await createUsersAndVaults('rag-unique')
    const cardA = await createCard(vaultA.id, 'rag-a.md', 'RAG A')
    const cardB = await createCard(vaultA.id, 'rag-b.md', 'RAG B')
    await prisma.ragDocumentIndex.create({
      data: {
        vaultId: vaultA.id,
        cardId: cardA.id,
        workspace: `workspace-rag-${runId}`,
        documentId: `doc-rag-${runId}`,
        contentHash: 'hash-a',
      },
    })

    await assert.rejects(
      prisma.ragDocumentIndex.create({
        data: {
          vaultId: vaultA.id,
          cardId: cardA.id,
          workspace: `workspace-rag-${runId}`,
          documentId: `doc-rag-other-${runId}`,
          contentHash: 'hash-b',
        },
      }),
    )

    await assert.rejects(
      prisma.ragDocumentIndex.create({
        data: {
          vaultId: vaultA.id,
          cardId: cardB.id,
          workspace: `workspace-rag-${runId}`,
          documentId: `doc-rag-${runId}`,
          contentHash: 'hash-c',
        },
      }),
    )

    await cleanupUsers(userA.id)
  })

  await t.test('memory, capability, skill, account, and session identity constraints are stable', async () => {
    const { userA, vaultA } = await createUsersAndVaults('identity-unique')

    await prisma.account.create({
      data: {
        userId: userA.id,
        providerId: 'github',
        accountId: `acct-${runId}`,
      },
    })
    await assert.rejects(
      prisma.account.create({
        data: {
          userId: userA.id,
          providerId: 'github',
          accountId: `acct-${runId}`,
        },
      }),
    )

    await prisma.session.create({
      data: {
        userId: userA.id,
        token: `token-${runId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await assert.rejects(
      prisma.session.create({
        data: {
          userId: userA.id,
          token: `token-${runId}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    )

    await prisma.vaultMemory.create({
      data: {
        vaultId: vaultA.id,
        key: 'preference',
        value: 'Use examples',
        category: 'preference',
      },
    })
    await assert.rejects(
      prisma.vaultMemory.create({
        data: {
          vaultId: vaultA.id,
          key: 'preference',
          value: 'Duplicate',
          category: 'preference',
        },
      }),
    )

    await prisma.vaultCapability.create({
      data: {
        vaultId: vaultA.id,
        concept: 'Recursion',
      },
    })
    await assert.rejects(
      prisma.vaultCapability.create({
        data: {
          vaultId: vaultA.id,
          concept: 'Recursion',
        },
      }),
    )

    await prisma.vaultSkill.create({
      data: {
        vaultId: vaultA.id,
        name: 'Feynman explanation',
        description: 'Explains with simple examples',
        evidence: 'manual-test',
      },
    })
    await assert.rejects(
      prisma.vaultSkill.create({
        data: {
          vaultId: vaultA.id,
          name: 'Feynman explanation',
          description: 'Duplicate',
          evidence: 'manual-test',
        },
      }),
    )

    await cleanupUsers(userA.id)
  })
})

async function createUsersAndVaults(label: string) {
  const userA = await prisma.user.create({
    data: {
      email: `${runId}-${label}-a@example.com`,
      name: `SDD ${label} A`,
      vaults: { create: { name: `SDD ${label} Vault A` } },
    },
    include: { vaults: true },
  })
  const userB = await prisma.user.create({
    data: {
      email: `${runId}-${label}-b@example.com`,
      name: `SDD ${label} B`,
      vaults: { create: { name: `SDD ${label} Vault B` } },
    },
    include: { vaults: true },
  })

  return {
    userA,
    userB,
    vaultA: userA.vaults[0],
    vaultB: userB.vaults[0],
  }
}

function createCard(vaultId: string, path: string, title: string) {
  return prisma.card.create({
    data: {
      vaultId,
      path,
      title,
      content: `# ${title}`,
      type: 'fleeting',
    },
  })
}

async function cleanupUsers(...userIds: string[]) {
  for (const userId of userIds) {
    await prisma.user.deleteMany({ where: { id: userId } })
  }
}
