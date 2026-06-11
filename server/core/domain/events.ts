import { prisma } from '@/lib/db'

export type DomainEventInput = {
  userId?: string | null
  vaultId?: string | null
  aggregateType: string
  aggregateId?: string | null
  eventType: string
  payload?: Record<string, unknown>
}

export async function emitDomainEvent(event: DomainEventInput): Promise<void> {
  try {
    const domainEventDelegate = (prisma as unknown as { domainEvent?: { create: (args: unknown) => Promise<unknown> } }).domainEvent
    if (!domainEventDelegate) return
    await domainEventDelegate.create({
      data: {
        userId: event.userId || null,
        vaultId: event.vaultId || null,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId || null,
        eventType: event.eventType,
        payload: JSON.stringify(event.payload || {}),
      },
    })
  } catch {
    // Domain events are observational; write failures must not break user actions.
  }
}

export async function recordPromotionAttempt(input: {
  userId?: string | null
  vaultId: string
  cardId?: string | null
  fromType?: string | null
  toType: string
  status: 'accepted' | 'rejected'
  missingElements?: string[]
  qualityChecks?: Record<string, unknown>
}): Promise<void> {
  try {
    const delegate = (prisma as unknown as { promotionAttempt?: { create: (args: unknown) => Promise<unknown> } }).promotionAttempt
    if (!delegate) return
    await delegate.create({
      data: {
        userId: input.userId || null,
        vaultId: input.vaultId,
        cardId: input.cardId || null,
        fromType: input.fromType || null,
        toType: input.toType,
        status: input.status,
        missingElements: input.missingElements ? JSON.stringify(input.missingElements) : null,
        qualityChecks: input.qualityChecks ? JSON.stringify(input.qualityChecks) : null,
      },
    })
  } catch {}
}

export async function recordAssessmentResult(input: {
  userId: string
  vaultId: string
  pathId?: string | null
  stepId?: string | null
  cardId?: string | null
  sessionId?: string | null
  concept: string
  passed: boolean
  mastery: number
  feedback: string
  evidence?: string[]
  clientContext?: string[]
}): Promise<void> {
  try {
    const delegate = (prisma as unknown as { assessmentResult?: { create: (args: unknown) => Promise<unknown> } }).assessmentResult
    if (!delegate) return
    await delegate.create({
      data: {
        userId: input.userId,
        vaultId: input.vaultId,
        pathId: input.pathId || null,
        stepId: input.stepId || null,
        cardId: input.cardId || null,
        sessionId: input.sessionId || null,
        concept: input.concept,
        passed: input.passed,
        mastery: input.mastery,
        feedback: input.feedback,
        evidence: input.evidence ? JSON.stringify(input.evidence) : null,
        clientContext: input.clientContext ? JSON.stringify(input.clientContext) : null,
      },
    })
  } catch {}
}

export async function recordCardRevision(input: {
  userId?: string | null
  vaultId: string
  cardId: string
  title?: string | null
  type?: string | null
  content: string
  reason?: string | null
}): Promise<void> {
  try {
    const delegate = (prisma as unknown as { cardRevision?: { create: (args: unknown) => Promise<unknown> } }).cardRevision
    if (!delegate) return
    await delegate.create({
      data: {
        userId: input.userId || null,
        vaultId: input.vaultId,
        cardId: input.cardId,
        title: input.title || null,
        type: input.type || null,
        content: input.content,
        reason: input.reason || null,
      },
    })
  } catch {}
}

export async function recordSourceDocument(input: {
  userId: string
  vaultId: string
  title: string
  source: string
  contentHash: string
  document: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const sourceDelegate = (prisma as unknown as {
      sourceDocument?: {
        upsert: (args: unknown) => Promise<{ id: string }>
      }
      sourceDocumentChunk?: {
        deleteMany: (args: unknown) => Promise<unknown>
        createMany: (args: unknown) => Promise<unknown>
      }
    }).sourceDocument
    const chunkDelegate = (prisma as unknown as {
      sourceDocumentChunk?: {
        deleteMany: (args: unknown) => Promise<unknown>
        createMany: (args: unknown) => Promise<unknown>
      }
    }).sourceDocumentChunk
    if (!sourceDelegate || !chunkDelegate) return
    const sourceDocument = await sourceDelegate.upsert({
      where: { vaultId_contentHash: { vaultId: input.vaultId, contentHash: input.contentHash } },
      update: {
        title: input.title,
        source: input.source,
        metadata: JSON.stringify(input.metadata || {}),
      },
      create: {
        userId: input.userId,
        vaultId: input.vaultId,
        title: input.title,
        source: input.source,
        contentHash: input.contentHash,
        metadata: JSON.stringify(input.metadata || {}),
      },
    })
    const chunks = chunkDocument(input.document)
    await chunkDelegate.deleteMany({ where: { sourceDocumentId: sourceDocument.id } })
    if (chunks.length > 0) {
      await chunkDelegate.createMany({
        data: chunks.map((content, index) => ({
          sourceDocumentId: sourceDocument.id,
          index,
          content,
          headingPath: null,
        })),
      })
    }
  } catch {}
}

function chunkDocument(document: string): string[] {
  const maxLength = 3000
  const chunks: string[] = []
  let offset = 0
  while (offset < document.length) {
    chunks.push(document.slice(offset, offset + maxLength))
    offset += maxLength
  }
  return chunks
}
