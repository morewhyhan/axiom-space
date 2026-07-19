import { prisma } from '@/lib/db'

export const ROOT_CARD_PATH = '__root__.md'
export const ROOT_CARD_TAG = 'axiom-root'
export const CONCEPT_CARD_TAG = 'concept-card'
export const CONTAINS_EDGE_TYPE = 'contains'

type ConceptCardInput = {
  vaultId: string
  title: string
  content?: string | null
  type?: 'fleeting' | 'permanent'
  clusterId?: string | null
  tags?: string[]
  pathFolder?: string | null
}

type ConceptCard = {
  id: string
  title: string | null
  type: string
  clusterId?: string | null
  path?: string
  content?: string
}

export function safeConceptFileName(value: string): string {
  return value
    .trim()
    .replace(/[/\\]/g, '_')
    .replace(/\.+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 100) || 'untitled'
}

export function normalizeConceptLookup(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:，,。.;；、/\\()[\]{}《》<>「」『』"'`~!@#$%^&*_+=|-]/g, '')
}

export async function ensureVaultRootCard(params: {
  vaultId: string
  vaultName?: string | null
}): Promise<ConceptCard> {
  const explicitName = params.vaultName?.trim()
  const vault = explicitName
    ? { name: explicitName }
    : await prisma.vault.findUnique({ where: { id: params.vaultId }, select: { name: true } })
  const name = vault?.name?.trim() || '知识库'
  const existing = await prisma.card.findUnique({
    where: { vaultId_path: { vaultId: params.vaultId, path: ROOT_CARD_PATH } },
    select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
  })
  if (existing) {
    // The white root node is the vault itself, not a separately generated
    // topic. Keep its label synchronized when a vault is renamed so every
    // ingestion path starts from the real warehouse name.
    if (existing.title !== name) {
      return prisma.card.update({
        where: { id: existing.id },
        data: { title: name },
        select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
      })
    }
    return existing
  }

  return prisma.card.create({
    data: {
      vaultId: params.vaultId,
      path: ROOT_CARD_PATH,
      title: name,
      type: 'fleeting',
      tags: JSON.stringify([ROOT_CARD_TAG, CONCEPT_CARD_TAG]),
      content: `# ${name}\n\n> 这是这个知识库的根理解卡。它记录你对整个主题的总体理解，并连接下面的概念卡。\n`,
    },
    select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
  })
}

export async function ensureConceptCard(input: ConceptCardInput): Promise<ConceptCard> {
  const title = input.title.trim()
  if (!title) throw new Error('CONCEPT_TITLE_REQUIRED')

  const existing = await prisma.card.findFirst({
    where: {
      vaultId: input.vaultId,
      title,
      type: { not: 'literature' },
      // The white vault root and a real topic card are different concepts even
      // when the vault happens to have the same name as the topic. Reusing the
      // root here collapses `vault -> topic` into one node and destroys the
      // hierarchy that document import is expected to build.
      path: { not: ROOT_CARD_PATH },
    },
    select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
    orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }],
  })
  if (existing) {
    if (!existing.clusterId && input.clusterId) {
      return prisma.card.update({
        where: { id: existing.id },
        data: { clusterId: input.clusterId },
        select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
      })
    }
    return existing
  }

  const folder = safeConceptFileName(input.pathFolder || 'concepts')
  const basePath = `${folder}/${safeConceptFileName(title)}.md`
  const path = await nextAvailableConceptPath(input.vaultId, basePath)
  const tags = Array.from(new Set([...(input.tags || []), CONCEPT_CARD_TAG].filter(Boolean)))
  return prisma.card.create({
    data: {
      vaultId: input.vaultId,
      clusterId: input.clusterId || undefined,
      path,
      title,
      type: input.type || 'fleeting',
      tags: JSON.stringify(tags),
      content: input.content || `# ${title}\n\n> 这是一张概念理解卡。它可以继续连接更细的子概念，也可以通过 AI 工作台打磨为永久知识。\n`,
    },
    select: { id: true, title: true, type: true, clusterId: true, path: true, content: true },
  })
}

export async function ensureContainsEdge(params: {
  vaultId: string
  parentId: string
  childId: string
  weight?: number
}): Promise<boolean> {
  if (!params.parentId || !params.childId || params.parentId === params.childId) return false
  const existing = await prisma.edge.findFirst({
    where: {
      vaultId: params.vaultId,
      sourceId: params.parentId,
      targetId: params.childId,
      type: CONTAINS_EDGE_TYPE,
    },
    select: { id: true },
  })
  if (existing) return false
  await prisma.edge.create({
    data: {
      vaultId: params.vaultId,
      sourceId: params.parentId,
      targetId: params.childId,
      type: CONTAINS_EDGE_TYPE,
      weight: params.weight ?? 1,
    },
  })
  return true
}

export async function ensureRootContainsConcept(params: {
  vaultId: string
  vaultName?: string | null
  conceptTitle: string
  clusterId?: string | null
  tags?: string[]
  content?: string | null
}): Promise<ConceptCard> {
  const root = await ensureVaultRootCard({ vaultId: params.vaultId, vaultName: params.vaultName })
  const concept = await ensureConceptCard({
    vaultId: params.vaultId,
    title: params.conceptTitle,
    clusterId: params.clusterId,
    tags: params.tags,
    content: params.content,
    pathFolder: params.conceptTitle,
  })
  await ensureContainsEdge({ vaultId: params.vaultId, parentId: root.id, childId: concept.id })
  return concept
}

async function nextAvailableConceptPath(vaultId: string, basePath: string): Promise<string> {
  const dot = basePath.endsWith('.md') ? basePath.length - 3 : basePath.length
  const stem = basePath.slice(0, dot)
  const ext = basePath.endsWith('.md') ? '.md' : ''
  let candidate = basePath
  for (let i = 2; i < 100; i += 1) {
    const existing = await prisma.card.findUnique({
      where: { vaultId_path: { vaultId, path: candidate } },
      select: { id: true },
    })
    if (!existing) return candidate
    candidate = `${stem}-${i}${ext}`
  }
  return `${stem}-${Date.now().toString(36)}${ext}`
}
