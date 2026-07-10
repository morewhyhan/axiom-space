import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfileTree } from '@/components/cognition/profile/model'
import type { ProfileDimensionInsight } from '@/hooks/use-cognition'
import { DEFAULT_PANEL_SIZES, useAppStore, type GraphLayoutMode } from '@/stores/mode-store'

test('profile evidence nodes preserve structured trace fields for the visible evidence drawer', () => {
  const dimension: ProfileDimensionInsight = {
    key: 'stuckPattern',
    label: '哪里会卡住',
    score: 0.52,
    confidence: 0.63,
    interpretation: '需要验证因果链缺口。',
    evidence: [],
    observations: [{
      text: '遇到省略前提时会停下来追问。',
      entryPoint: 'LearningMessage',
      evidence: '用户原话：我知道代码怎么写，但不知道为什么要多调一次。',
      confidence: 0.61,
      analysisMode: 'llm_context',
      sourceType: 'vaultMemory',
      sourceId: 'message-visitor-1',
    }],
  }

  const [view] = buildProfileTree(null, [dimension])
  const [node] = view.nodes

  assert.deepEqual(node.evidenceTrace, {
    sourceLabel: '画像观察',
    sourceType: 'vaultMemory',
    sourceId: 'message-visitor-1',
    sourceLocation: 'LearningMessage',
    evidence: '用户原话：我知道代码怎么写，但不知道为什么要多调一次。',
    analysisMode: 'llm_context',
  })
  assert.equal(node.freshness, '有新证据')
  assert.match(node.promptEffect, /卡点/)
})

test('UI state contracts keep page state separate from domain objects', async (t) => {
  await t.test('mode switching changes only the UI mode value', () => {
    const before = snapshotStore()
    useAppStore.getState().setMode('forge')
    assert.equal(useAppStore.getState().mode, 'forge')
    assert.deepEqual(domainNeutralSnapshot(), {
      currentVaultId: before.currentVaultId,
      selectedNode: before.selectedNode,
      selectedPathId: before.selectedPathId,
      activeLearningStepId: before.activeLearningStepId,
    })
  })

  await t.test('selected node can be cleared together with prefetched card cache', () => {
    useAppStore.getState().setSelectedNode({ id: 'card-a', title: 'Card A', type: 'fleeting' })
    useAppStore.getState().setPrefetchedCard({ id: 'card-a', title: 'Card A', content: '# Card A' })
    assert.equal(useAppStore.getState().selectedNode?.id, 'card-a')
    assert.equal(useAppStore.getState().prefetchedCard?.id, 'card-a')

    useAppStore.getState().clearSelectedNode()
    assert.equal(useAppStore.getState().selectedNode, null)
    assert.equal(useAppStore.getState().prefetchedCard, null)
  })

  await t.test('panel layout operations only move UI panel IDs and clamp panel sizes', () => {
    useAppStore.getState().setPanelLayout({ left: ['sessionList'], right: ['editor'] })
    useAppStore.getState().movePanel('fileTree', 'left', 0)
    assert.deepEqual(useAppStore.getState().panelLayout.left, ['fileTree', 'sessionList'])
    assert.deepEqual(useAppStore.getState().panelLayout.right, ['editor'])

    useAppStore.getState().togglePanel('fileTree')
    assert.equal(useAppStore.getState().panelLayout.left.includes('fileTree'), false)

    useAppStore.getState().setPanelSize('editor', 50)
    assert.equal(useAppStore.getState().panelSizes.editor, 200)
    useAppStore.getState().setPanelSize('editor', 1200)
    assert.equal(useAppStore.getState().panelSizes.editor, 800)
    useAppStore.getState().setPanelSize('editor', DEFAULT_PANEL_SIZES.editor)
    assert.equal(useAppStore.getState().panelSizes.editor, DEFAULT_PANEL_SIZES.editor)
  })

  await t.test('forge left panel selection stays independent from panel layout mutations', () => {
    useAppStore.getState().setForgeResourceView('cards')
    useAppStore.getState().setForgeCardFilter('literature')
    useAppStore.getState().setForgeContextTab('talks')

    useAppStore.getState().setPanelLayout({ left: ['sessionList'], right: [] })

    assert.equal(useAppStore.getState().forgeResourceView, 'cards')
    assert.equal(useAppStore.getState().forgeCardFilter, 'literature')
    assert.equal(useAppStore.getState().forgeContextTab, 'talks')

    useAppStore.getState().setForgeResourceView('context')
    assert.deepEqual(useAppStore.getState().panelLayout.left, ['sessionList'])
  })

  await t.test('learn selection and graph layout are UI-only references', () => {
    useAppStore.getState().setSelectedPathId('path-a')
    useAppStore.getState().setActiveLearningStepId('step-a')
    assert.equal(useAppStore.getState().selectedPathId, 'path-a')
    assert.equal(useAppStore.getState().activeLearningStepId, 'step-a')

    const modes: GraphLayoutMode[] = ['galaxy', 'flat', 'radial', 'concentric', 'layered', 'matrix', 'task-flow', 'timeline', 'mastery', 'evidence']
    for (const mode of modes) {
      useAppStore.getState().setGraphLayoutMode(mode)
      assert.equal(useAppStore.getState().graphLayoutMode, mode)
    }
  })

  await t.test('persisted UI state excludes volatile modal, selected node, and business data', () => {
    useAppStore.getState().openModal('search')
    useAppStore.getState().setSelectedNode({ id: 'card-b', title: 'Card B', type: 'permanent' })
    const persisted = JSON.stringify({
      lastVaultId: useAppStore.getState().lastVaultId,
      currentVaultId: useAppStore.getState().currentVaultId,
      hasCounted: useAppStore.getState().hasCounted,
      hasCompletedOnboarding: useAppStore.getState().hasCompletedOnboarding,
      panelLayout: useAppStore.getState().panelLayout,
      panelSizes: useAppStore.getState().panelSizes,
      chatPanelOpen: useAppStore.getState().chatPanelOpen,
      forgeResourceView: useAppStore.getState().forgeResourceView,
      forgeContextTab: useAppStore.getState().forgeContextTab,
      forgeCardFilter: useAppStore.getState().forgeCardFilter,
      graphLayoutMode: useAppStore.getState().graphLayoutMode,
      graphHoverAttention: useAppStore.getState().graphHoverAttention,
    })

    assert.equal(persisted.includes('search'), false)
    assert.equal(persisted.includes('card-b'), false)
    assert.equal(persisted.includes('Card B'), false)
  })
})

function snapshotStore() {
  const state = useAppStore.getState()
  return {
    currentVaultId: state.currentVaultId,
    selectedNode: state.selectedNode,
    selectedPathId: state.selectedPathId,
    activeLearningStepId: state.activeLearningStepId,
  }
}

function domainNeutralSnapshot() {
  const state = useAppStore.getState()
  return {
    currentVaultId: state.currentVaultId,
    selectedNode: state.selectedNode,
    selectedPathId: state.selectedPathId,
    activeLearningStepId: state.activeLearningStepId,
  }
}
