/**
 * DbAdapter — 基于 Prisma 的 IFileStorage 实现
 *
 * 把 MD 文件存在数据库里。一个用户一个 vault，
 * 每张卡片存一行，content 存完整 Markdown。
 *
 * Agent 视角：调 readFile/writeFile，拿 MD 文本
 * 底层视角：调 Prisma CRUD，操作 card 表
 */

import type { IFileStorage, ReadResult, WriteResult, ListResult, DeleteResult, SearchResult, FileEntry } from './IFileStorage'
import { prisma } from '@/lib/db'
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context'
import { parseWikiLinks, resolveWikiLinkTitle } from '@/lib/wiki-links'
import { assertCardType, inferCardTypeFromPath } from '@/server/core/domain/contracts'
import { ensureVaultRootCard } from '@/server/core/domain/concept-graph'
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index'

export class DbAdapter implements IFileStorage {
  private resolvedUserId: string

  constructor(userId?: string) {
    // 如果没传 userId，从 AsyncLocalStorage 上下文自动获取
    this.resolvedUserId = userId || getCurrentUserId() || ''
  }

  private get userId(): string {
    // 如果构造时没拿到 userId，运行时再试一次
    if (!this.resolvedUserId) {
      this.resolvedUserId = getCurrentUserId() || ''
    }
    return this.resolvedUserId
  }

  /**
   * Reject path-traversal and absolute paths before they ever reach Prisma.
   * The vault is multi-tenant; even though the DbAdapter scopes by `vaultId`,
   * we want defense-in-depth so a path like "../../etc/passwd.md" or
   * "/abs/path" can never end up in the `card.path` column or be used to
   * cross vault boundaries.
   */
  private assertSafePath(p: string): void {
    if (!p || typeof p !== 'string') {
      throw new Error('Invalid path: empty')
    }
    if (p.startsWith('/') || p.startsWith('\\')) {
      throw new Error(`Invalid path: absolute paths are not allowed (${p})`)
    }
    // Drive letter on Windows (e.g. "C:\…")
    if (/^[a-zA-Z]:/.test(p)) {
      throw new Error(`Invalid path: drive-letter paths are not allowed (${p})`)
    }
    // Any segment equal to ".." — covers "../x", "x/../y", etc.
    const segments = p.split(/[\\/]+/)
    for (const seg of segments) {
      if (seg === '..') {
        throw new Error(`Invalid path: traversal segment "${seg}" in "${p}"`)
      }
    }
  }

  /**
   * Resolve the active vault id. Precedence:
   * 1. explicit argument (callers may pass their own override)
   * 2. AsyncLocalStorage agent context (`runWithAgentContext({ userId, vaultId }, ...)`)
   * 3. fall back to the user's oldest vault
   */
  private async getVaultId(vaultId?: string): Promise<string | null> {
    const ctxVaultId = vaultId ?? getCurrentVaultId();
    if (ctxVaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: ctxVaultId } });
      if (vault?.userId === this.userId) return vault.id;
      return null;
    }
    const vault = await prisma.vault.findFirst({
      where: { userId: this.userId },
      orderBy: { createdAt: 'asc' },
    })
    return vault?.id || null
  }

  private async ensureVaultId(vaultId?: string): Promise<string> {
    const ctxVaultId = vaultId ?? getCurrentVaultId();
    if (ctxVaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: ctxVaultId } });
      if (vault?.userId === this.userId) return vault.id;
      throw new Error('Vault not found or not owned by current user')
    }
    let vault = await prisma.vault.findFirst({
      where: { userId: this.userId },
      orderBy: { createdAt: 'asc' },
    })
    if (!vault) {
      vault = await prisma.vault.create({
        data: { userId: this.userId, name: 'My Vault' },
      })
      await ensureVaultRootCard({ vaultId: vault.id, vaultName: vault.name })
    }
    return vault.id
  }

  async readFile(filePath: string, vaultId?: string): Promise<ReadResult> {
    try {
      this.assertSafePath(filePath)
      const resolvedVaultId = await this.getVaultId(vaultId)
      if (!resolvedVaultId) return { success: false, error: 'Vault not found' }

      const card = await prisma.card.findUnique({
        where: { vaultId_path: { vaultId: resolvedVaultId, path: filePath } },
      })
      if (!card) return { success: false, error: `File not found: ${filePath}` }

      return { success: true, content: card.content }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async writeFile(filePath: string, content: string, cardType?: string): Promise<WriteResult> {
    try {
      this.assertSafePath(filePath)
      const vaultId = await this.ensureVaultId()

      // 从路径推断 type (如果没提供)
      const type = cardType ? assertCardType(cardType) : inferCardTypeFromPath(filePath)

      // 从路径提取 title
      const title = filePath.replace(/\.md$/, '').split('/').pop() || 'untitled'

      const card = await prisma.$transaction(async (tx) => {
        const upserted = await tx.card.upsert({
          where: { vaultId_path: { vaultId, path: filePath } },
          create: { vaultId, path: filePath, content, type, title },
          update: { content, type, title, updatedAt: new Date() },
        })

        // Sync [[WikiLink]] edges atomically with the card write
        const titles = parseWikiLinks(content)
        const resolved = await Promise.all(
          titles.map((t) => resolveWikiLinkTitle(tx, vaultId, t)),
        )
        const targets = Array.from(
          new Map((resolved.filter(Boolean) as { id: string }[]).map((target) => [target.id, target])).values(),
        )

        await tx.edge.deleteMany({ where: { sourceId: upserted.id, type: 'wikilink' } })
        if (targets.length > 0) {
          await tx.edge.createMany({
            data: targets.map((target) => ({
              vaultId,
              sourceId: upserted.id,
              targetId: target.id,
              type: 'wikilink' as const,
              weight: 1.0,
            })),
          })
        }

        return upserted
      }, { timeout: 30_000 })

      scheduleRagIndexCard(card.id, 'db-adapter-write')
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async deleteFile(filePath: string): Promise<DeleteResult> {
    try {
      this.assertSafePath(filePath)
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: false, error: 'Vault not found' }

      // Find cards matching path so we can clean up their edges
      const cards = await prisma.card.findMany({
        where: { vaultId, path: filePath },
        select: { id: true },
      })
      if (cards.length > 0) {
        const cardIds = cards.map(c => c.id)
        await prisma.$transaction([
          prisma.edge.deleteMany({ where: { OR: [{ sourceId: { in: cardIds } }, { targetId: { in: cardIds } }] } }),
          prisma.card.deleteMany({ where: { vaultId, path: filePath } }),
        ])
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async listDir(dirPath: string): Promise<ListResult> {
    try {
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: true, entries: [] }

      // 列出路径前缀匹配的卡片
      const prefix = dirPath ? `${dirPath}/` : ''
      const cards = await prisma.card.findMany({
        where: {
          vaultId,
          path: dirPath ? { startsWith: prefix } : undefined,
        },
        select: { path: true, title: true, type: true, updatedAt: true },
      })

      // 模拟文件系统：去重生成目录和文件条目
      const entries: FileEntry[] = []
      const dirs = new Set<string>()

      for (const card of cards) {
        const relativePath = dirPath
          ? card.path.slice(prefix.length)
          : card.path

        const parts = relativePath.split('/')
        if (parts.length > 1) {
          // 是子目录中的文件
          const subDir = parts[0]
          if (!dirs.has(subDir)) {
            dirs.add(subDir)
            entries.push({
              name: subDir,
              path: `${dirPath ? dirPath + '/' : ''}${subDir}`,
              isDirectory: true,
            })
          }
        } else {
          entries.push({
            name: parts[0],
            path: card.path,
            isDirectory: false,
            updatedAt: card.updatedAt.toISOString(),
          })
        }
      }

      return { success: true, entries }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** DB 模式下目录是虚拟的，无需创建 */
  async ensureDir(_dirPath: string): Promise<WriteResult> {
    return { success: true }
  }

  async rename(oldPath: string, newPath: string): Promise<WriteResult> {
    try {
      this.assertSafePath(oldPath)
      this.assertSafePath(newPath)
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: false, error: 'Vault not found' }

      const card = await prisma.card.findUnique({
        where: { vaultId_path: { vaultId, path: oldPath } },
      })
      if (!card) return { success: false, error: `File not found: ${oldPath}` }

      await prisma.card.update({
        where: { id: card.id },
        data: { path: newPath, title: newPath.replace(/\.md$/, '').split('/').pop() },
      })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async search(query: string, _rootPath?: string): Promise<SearchResult> {
    try {
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: true, results: [] }

      const cards = await prisma.card.findMany({
        where: {
          vaultId,
          OR: [
            { content: { contains: query } },
            { title: { contains: query } },
            { path: { contains: query } },
          ],
        },
        select: { path: true, title: true, content: true },
        take: 50,
      })

      const results = cards.map(c => ({
        path: c.path,
        title: c.title || c.path,
        snippet: c.content.includes(query)
          ? c.content.substring(c.content.indexOf(query), c.content.indexOf(query) + 200)
          : c.content.substring(0, 200),
        score: 1,
      }))

      return { success: true, results }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
