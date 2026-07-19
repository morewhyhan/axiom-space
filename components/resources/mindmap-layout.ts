export type MindmapNode = {
  id: string
  label: string
  depth: number
  parentId?: string
}

export type MindmapLayoutNode = MindmapNode & {
  x: number
  y: number
  width: number
  height: number
  lines: string[]
}

export type MindmapLayout = {
  nodes: MindmapLayoutNode[]
  edges: Array<{ from: MindmapLayoutNode; to: MindmapLayoutNode }>
  width: number
  height: number
}

type SourceLine = {
  indent: number
  label: string
}

const NODE_WIDTH = 196
const COLUMN_GAP = 90
const ROW_GAP = 96
const HORIZONTAL_MARGIN = 80
const VERTICAL_MARGIN = 80

/**
 * Parse the indentation-based subset shared by Mermaid mindmaps and Markdown
 * outline lists. The original source remains untouched for downloads; this
 * parser exists solely to provide a fast, deterministic in-app preview.
 */
export function parseMindmap(source: string, fallbackTitle = '知识导图'): MindmapNode[] {
  const sourceLines = normalizeSource(source)
  if (sourceLines.length === 0) {
    return [{ id: 'mindmap-node-0', label: fallbackTitle, depth: 0 }]
  }

  const nodes: MindmapNode[] = []
  const ancestors: Array<{ indent: number; node: MindmapNode }> = []

  for (const line of sourceLines) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].indent >= line.indent) {
      ancestors.pop()
    }

    const parent = ancestors[ancestors.length - 1]?.node
    const node: MindmapNode = {
      id: `mindmap-node-${nodes.length}`,
      label: line.label,
      depth: parent ? parent.depth + 1 : 0,
      ...(parent ? { parentId: parent.id } : {}),
    }
    nodes.push(node)
    ancestors.push({ indent: line.indent, node })
  }

  return nodes
}

export function layoutMindmap(nodes: MindmapNode[]): MindmapLayout {
  const safeNodes = nodes.length > 0 ? nodes : parseMindmap('')
  const byId = new Map(safeNodes.map((node) => [node.id, node]))
  const children = new Map<string, MindmapNode[]>()
  for (const node of safeNodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  }

  const relativeY = new Map<string, number>()
  let leafIndex = 0
  const placeSubtree = (node: MindmapNode): number => {
    const childNodes = children.get(node.id) ?? []
    if (childNodes.length === 0) {
      const y = leafIndex * ROW_GAP
      leafIndex += 1
      relativeY.set(node.id, y)
      return y
    }
    const childPositions = childNodes.map(placeSubtree)
    const y = childPositions.reduce((sum, value) => sum + value, 0) / childPositions.length
    relativeY.set(node.id, y)
    return y
  }

  const roots = safeNodes.filter((node) => !node.parentId || !byId.has(node.parentId))
  roots.forEach(placeSubtree)

  const leafCount = Math.max(leafIndex, 1)
  const contentHeight = (leafCount - 1) * ROW_GAP
  const height = Math.max(360, contentHeight + VERTICAL_MARGIN * 2)
  const yOffset = (height - contentHeight) / 2
  const maxDepth = Math.max(...safeNodes.map((node) => node.depth), 0)
  const width = HORIZONTAL_MARGIN * 2 + NODE_WIDTH + maxDepth * (NODE_WIDTH + COLUMN_GAP)

  const layoutNodes = safeNodes.map<MindmapLayoutNode>((node) => {
    const lines = wrapLabel(node.label)
    return {
      ...node,
      x: HORIZONTAL_MARGIN + NODE_WIDTH / 2 + node.depth * (NODE_WIDTH + COLUMN_GAP),
      y: (relativeY.get(node.id) ?? 0) + yOffset,
      width: NODE_WIDTH,
      height: Math.max(58, 28 + lines.length * 18),
      lines,
    }
  })
  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]))
  const edges = layoutNodes.flatMap((node) => {
    if (!node.parentId) return []
    const from = layoutById.get(node.parentId)
    return from ? [{ from, to: node }] : []
  })

  return { nodes: layoutNodes, edges, width, height }
}

function normalizeSource(source: string): SourceLine[] {
  let normalized = source.trim()
  const fenced = normalized.match(/^```(?:mermaid|mindmap)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenced?.[1]) normalized = fenced[1]

  return normalized
    .replace(/\t/g, '  ')
    .split(/\r?\n/)
    .flatMap((rawLine) => {
      if (!rawLine.trim()) return []
      const trimmed = rawLine.trim()
      if (/^(mindmap|direction\s+(?:TB|BT|LR|RL)|%%.*)$/i.test(trimmed)) return []

      const heading = rawLine.match(/^\s*(#{1,6})\s+(.+)$/)
      const leadingWhitespace = rawLine.match(/^\s*/)?.[0].length ?? 0
      const indent = heading ? (heading[1].length - 1) * 2 : leadingWhitespace
      const rawLabel = (heading?.[2] ?? trimmed).replace(/^[-*+]\s+/, '')
      const label = unwrapNodeLabel(rawLabel)
      return label ? [{ indent, label }] : []
    })
}

function unwrapNodeLabel(rawLabel: string): string {
  let label = rawLabel.trim().replace(/:::[\w-]+\s*$/, '').trim()
  const shapedNodePatterns = [
    /^[^\s()[\]{}]+\s*\(\((.*?)\)\)$/,
    /^[^\s()[\]{}]+\s*\[\[(.*?)\]\]$/,
    /^[^\s()[\]{}]+\s*\{\{(.*?)\}\}$/,
    /^[^\s()[\]{}]+\s*\((.*?)\)$/,
    /^[^\s()[\]{}]+\s*\[(.*?)\]$/,
    /^[^\s()[\]{}]+\s*\{(.*?)\}$/,
  ]
  for (const pattern of shapedNodePatterns) {
    const match = label.match(pattern)
    if (match?.[1]) {
      label = match[1].trim()
      break
    }
  }
  return label.replace(/^["'`]+|["'`]+$/g, '').trim()
}

function wrapLabel(label: string, maxUnits = 18, maxLines = 3): string[] {
  const lines: string[] = []
  let current = ''
  let currentUnits = 0

  for (const character of Array.from(label)) {
    const units = /[\u2e80-\u9fff\uf900-\ufaff]/.test(character) ? 2 : 1
    if (current && currentUnits + units > maxUnits) {
      lines.push(current.trim())
      current = ''
      currentUnits = 0
    }
    current += character
    currentUnits += units
  }
  if (current.trim()) lines.push(current.trim())

  if (lines.length <= maxLines) return lines.length > 0 ? lines : [label]
  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/[….]+$/, '')}…`
  return visible
}
