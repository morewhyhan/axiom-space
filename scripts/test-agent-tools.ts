/**
 * Agent Tool Integration Test
 *
 * Tests every agent tool against the real DB to verify full CRUD capability.
 * Run with: npx tsx scripts/test-agent-tools.ts
 */

import { prisma } from '../lib/db'
import { runWithAgentContext, getCurrentVaultId, getCurrentUserId } from '../server/core/agent/agent-context'
import { registerBuiltinTools } from '../server/core/agent/builtin-tools'
import { toolRegistry } from '../server/core/agent/tools'

// Register all tools (must be done before testing)
registerBuiltinTools()

interface TestResult {
  tool: string
  passed: boolean
  error?: string
  detail?: string
}

const results: TestResult[] = []

function record(tool: string, passed: boolean, detail?: string, error?: string) {
  results.push({ tool, passed, detail, error })
  const icon = passed ? '✅' : '❌'
  console.log(`${icon} ${tool}${detail ? ': ' + detail : ''}`)
  if (error) console.log(`   Error: ${error}`)
}

async function main() {
  console.log('=== Agent Tool Integration Test ===\n')

  // 1. Find or create test user
  let user = await prisma.user.findFirst({ where: { email: 'demo@axiom.space' } })
  if (!user) {
    console.log('Creating test user...')
    user = await prisma.user.create({
      data: { email: 'demo@axiom.space', name: 'Test User', emailVerified: true },
    })
  }
  const userId = user.id
  console.log(`User: ${user.email} (${userId})\n`)

  // 2. Find or create test vault
  let vault = await prisma.vault.findFirst({ where: { userId } })
  if (!vault) {
    console.log('Creating test vault...')
    vault = await prisma.vault.create({ data: { userId, name: 'Test Vault' } })
  }
  const vaultId = vault.id
  console.log(`Vault: ${vault.name} (${vaultId})\n`)

  // Clean up test cards from previous runs
  await prisma.card.deleteMany({ where: { vaultId, title: { startsWith: '__TEST__' } } }).catch(() => {})
  await prisma.edge.deleteMany({ where: { vaultId } }).catch(() => {})

  // Run all tests inside agent context
  await runWithAgentContext({ userId, vaultId }, async () => {
    const ctxVaultId = getCurrentVaultId()
    const ctxUserId = getCurrentUserId()
    console.log(`Context check: vaultId=${ctxVaultId}, userId=${ctxUserId}\n`)
    record('agent_context', ctxVaultId === vaultId && ctxUserId === userId,
      ctxVaultId === vaultId ? 'AsyncLocalStorage works' : 'FAILED')

    // ══════════════════════════════════════════════
    // CARD TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- Card Tools ---')

    // Test create_fleeing_card
    const fleeCardTool = toolRegistry.get('create_fleeing_card')
    if (!fleeCardTool) {
      record('create_fleeing_card', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (fleeCardTool as any).execute('test1', {
          title: '__TEST__FleeingCard',
          content: '# Test Fleeing\n\nThis is a test fleeting card.',
          tags: ['test', 'fleeting'],
          links: { to: [] },
        })
        const ok = r?.content?.[0]?.text?.includes('已创建') || r?.details?.id
        record('create_fleeing_card', ok, ok ? 'Card created' : 'Failed', ok ? undefined : JSON.stringify(r))
      } catch (e: any) {
        record('create_fleeing_card', false, undefined, e.message)
      }
    }

    // Test search_cards
    const searchTool = toolRegistry.get('search_cards')
    if (!searchTool) {
      record('search_cards', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (searchTool as any).execute('test2', {
          query: '__TEST__',
          type: 'all',
        })
        const found = r?.content?.[0]?.text?.includes('__TEST__') || (r?.details?.count > 0)
        record('search_cards', found, found ? `Found ${r?.details?.count || '?'} cards` : 'Not found')
      } catch (e: any) {
        record('search_cards', false, undefined, e.message)
      }
    }

    // Test create_permanent_card
    const permCardTool = toolRegistry.get('create_permanent_card')
    if (!permCardTool) {
      record('create_permanent_card', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (permCardTool as any).execute('test3', {
          title: '__TEST__PermanentCard',
          content: '# Test Permanent\n\nPermanent card with definition.\n\n## Example\nTest example.',
          tags: ['test', 'permanent'],
          links: { to: ['__TEST__FleeingCard'] },
        })
        const ok = r?.content?.[0]?.text?.includes('已创建') || r?.content?.[0]?.text?.includes('永久')
        record('create_permanent_card', ok, ok ? 'Permanent card created' : 'Failed', ok ? undefined : JSON.stringify(r))
      } catch (e: any) {
        record('create_permanent_card', false, undefined, e.message)
      }
    }

    // Verify card in DB
    try {
      const dbCard = await prisma.card.findFirst({ where: { vaultId, title: '__TEST__FleeingCard' } })
      record('card_db_verify', !!dbCard, dbCard ? `DB has card id=${dbCard.id.slice(0,8)} type=${dbCard.type}` : 'NOT FOUND')
    } catch (e: any) {
      record('card_db_verify', false, undefined, e.message)
    }

    // Test delete_card
    try {
      const card = await prisma.card.findFirst({ where: { vaultId, title: '__TEST__FleeingCard' } })
      if (card) {
        const delTool = toolRegistry.get('delete_card')
        if (delTool) {
          await (delTool as any).execute('test4', { cardPath: card.path })
          const deleted = await prisma.card.findUnique({ where: { id: card.id } })
          record('delete_card', !deleted, !deleted ? 'Card deleted' : 'Still exists')
        } else {
          record('delete_card', false, undefined, 'Tool not registered')
        }
      } else {
        record('delete_card', false, undefined, 'No card to delete')
      }
    } catch (e: any) {
      record('delete_card', false, undefined, e.message)
    }

    // ══════════════════════════════════════════════
    // MEMORY TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- Memory Tools ---')

    // Test write_memory
    const writeMemTool = toolRegistry.get('write_memory')
    if (!writeMemTool) {
      record('write_memory', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (writeMemTool as any).execute('test5', {
          target: 'user',
          content: JSON.stringify({ test: true, note: 'Agent tool test memory write', timestamp: Date.now() }),
        })
        record('write_memory', r?.content?.[0]?.text ? true : false, 'Memory written')
      } catch (e: any) {
        record('write_memory', false, undefined, e.message)
      }
    }

    // Test memory_search
    const memSearchTool = toolRegistry.get('memory_search')
    if (!memSearchTool) {
      record('memory_search', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (memSearchTool as any).execute('test6', { query: 'test' })
        record('memory_search', !!r?.content?.[0]?.text, 'Memory search executed')
      } catch (e: any) {
        record('memory_search', false, undefined, e.message)
      }
    }

    // ══════════════════════════════════════════════
    // SESSION TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- Session Tools ---')

    // Test refresh_vault
    const refreshTool = toolRegistry.get('refresh_vault')
    if (!refreshTool) {
      record('refresh_vault', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (refreshTool as any).execute('test7', {})
        const ok = r?.content?.[0]?.text?.includes('Vault') || r?.details?.totalCards !== undefined
        record('refresh_vault', ok, ok ? `Vault refreshed: ${JSON.stringify(r?.details)}` : 'Failed')
      } catch (e: any) {
        record('refresh_vault', false, undefined, e.message)
      }
    }

    // Test feynman_test (mode 1: ask question)
    const feynmanTool = toolRegistry.get('feynman_test')
    if (!feynmanTool) {
      record('feynman_test', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (feynmanTool as any).execute('test8', { concept: '__TEST__PermanentCard' })
        const ok = r?.details?.awaitingUserResponse === true
        record('feynman_test (ask)', ok, ok ? 'Feynman question sent' : 'Failed')
      } catch (e: any) {
        record('feynman_test (ask)', false, undefined, e.message)
      }

      // Test feynman_test (mode 2: evaluate)
      try {
        const r = await (feynmanTool as any).execute('test9', {
          concept: '__TEST__PermanentCard',
          userResponse: 'This is a test concept used for verifying the Feynman test tool. It demonstrates the definition, examples, and associations with other test concepts like __TEST__FleeingCard.',
        })
        const ok = r?.details?.pass !== undefined || r?.details?.step === 'completed'
        record('feynman_test (eval)', ok, ok ? `Evaluation: scores=${JSON.stringify(r?.details?.scores)} pass=${r?.details?.pass}` : 'Failed')
      } catch (e: any) {
        record('feynman_test (eval)', false, undefined, e.message)
      }
    }

    // Test assess_understanding
    const assessTool = toolRegistry.get('assess_understanding')
    if (!assessTool) {
      record('assess_understanding', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (assessTool as any).execute('test10', { concept: '__TEST__PermanentCard', method: 'feynman' })
        record('assess_understanding', !!r?.details?.question, r?.details?.question ? 'Assessment question generated' : 'Failed')
      } catch (e: any) {
        record('assess_understanding', false, undefined, e.message)
      }
    }

    // ══════════════════════════════════════════════
    // RESOURCE TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- Resource Tools ---')

    // Test extract_cards (non-auto mode)
    const extractTool = toolRegistry.get('extract_cards')
    if (!extractTool) {
      record('extract_cards', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (extractTool as any).execute('test11', {
          literatureTitle: '__TEST__Literature',
          literatureContent: '# Test Literature\n\nThis document defines the concept of Test-Driven Development (TDD). TDD is a software development process where tests are written before code.\n\nAnother concept is Continuous Integration (CI), which is the practice of merging all developer working copies to a shared mainline several times a day.',
          auto: false,
        })
        const ok = r?.details?.awaitingConfirmation === true || r?.details?.candidates?.length > 0
        record('extract_cards', ok, ok ? `Found ${r?.details?.candidates?.length || 0} candidates` : 'Failed')
      } catch (e: any) {
        record('extract_cards', false, undefined, e.message)
      }
    }

    // ══════════════════════════════════════════════
    // GRAPH TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- Graph Tools ---')

    // Test add_graph_node
    const graphNodeTool = toolRegistry.get('add_graph_node')
    if (!graphNodeTool) {
      record('add_graph_node', false, undefined, 'Tool not registered')
    } else {
      try {
        const r = await (graphNodeTool as any).execute('test12', {
          concept: '__TEST__GraphNode',
          definition: 'A test graph node for verification.',
        })
        record('add_graph_node', !!r?.content?.[0]?.text, 'Graph node added')
      } catch (e: any) {
        record('add_graph_node', false, undefined, e.message)
      }
    }

    // Test add_graph_edge
    try {
      const sourceCard = await prisma.card.findFirst({ where: { vaultId, title: '__TEST__GraphNode' } })
      const targetCard = await prisma.card.findFirst({ where: { vaultId, title: '__TEST__PermanentCard' } })
      if (sourceCard && targetCard) {
        const graphEdgeTool = toolRegistry.get('add_graph_edge')
        if (graphEdgeTool) {
          const r = await (graphEdgeTool as any).execute('test13', {
            source: sourceCard.title,
            target: targetCard.title,
            relationship: 'related',
          })
          record('add_graph_edge', !!r?.content?.[0]?.text, 'Graph edge added')
        } else {
          record('add_graph_edge', false, undefined, 'Tool not registered')
        }
      } else {
        record('add_graph_edge', false, undefined, `Missing cards: source=${!!sourceCard} target=${!!targetCard}`)
      }
    } catch (e: any) {
      record('add_graph_edge', false, undefined, e.message)
    }

    // Verify edge in DB
    try {
      const edgeCount = await prisma.edge.count({ where: { vaultId } })
      record('edge_db_verify', edgeCount > 0, `${edgeCount} edges in DB`)
    } catch (e: any) {
      record('edge_db_verify', false, undefined, e.message)
    }

    // ══════════════════════════════════════════════
    // FILE TOOLS
    // ══════════════════════════════════════════════
    console.log('\n--- File Tools ---')

    // Test read
    const readTool = toolRegistry.get('read')
    if (!readTool) {
      record('read', false, undefined, 'Tool not registered')
    } else {
      try {
        const permCard = await prisma.card.findFirst({ where: { vaultId, title: '__TEST__PermanentCard' } })
        if (permCard) {
          const r = await (readTool as any).execute('test14', { filePath: permCard.path })
          record('read', r?.content?.[0]?.text ? true : false, 'File read successfully')
        } else {
          record('read', false, undefined, 'No test file to read')
        }
      } catch (e: any) {
        record('read', false, undefined, e.message)
      }
    }
  })

  // ══════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════
  console.log('\n=== Summary ===')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`)

  if (failed > 0) {
    console.log('\n❌ Failed tools:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.tool}: ${r.error || r.detail || 'Unknown error'}`)
    })
  }

  // Cleanup test data
  await prisma.card.deleteMany({ where: { vaultId, title: { startsWith: '__TEST__' } } }).catch(() => {})
  await prisma.edge.deleteMany({ where: { vaultId } }).catch(() => {})

  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Test harness error:', err)
  prisma.$disconnect()
  process.exit(1)
})
