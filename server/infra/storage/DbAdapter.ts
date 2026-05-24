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

export class DbAdapter implements IFileStorage {
  constructor(private userId: string) {}

  private async getVaultId(vaultId?: string): Promise<string | null> {
    if (vaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
      return vault?.id || null;
    }
    const vault = await prisma.vault.findFirst({
      where: { userId: this.userId },
    })
    return vault?.id || null
  }

  private async ensureVaultId(vaultId?: string): Promise<string> {
    if (vaultId) {
      const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
      if (vault) return vault.id;
    }
    let vault = await prisma.vault.findFirst({
      where: { userId: this.userId },
    })
    if (!vault) {
      vault = await prisma.vault.create({
        data: { userId: this.userId, name: 'My Vault' },
      })
    }
    return vault.id
  }

  async readFile(filePath: string): Promise<ReadResult> {
    try {
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: false, error: 'Vault not found' }

      const card = await prisma.card.findUnique({
        where: { vaultId_path: { vaultId, path: filePath } },
      })
      if (!card) return { success: false, error: `File not found: ${filePath}` }

      return { success: true, content: card.content }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async writeFile(filePath: string, content: string): Promise<WriteResult> {
    try {
      const vaultId = await this.ensureVaultId()

      // 从路径推断 type
      const type = filePath.startsWith('literature/') ? 'literature'
        : filePath.startsWith('permanent/') ? 'permanent'
        : 'fleeting'

      // 从路径提取 title
      const title = filePath.replace(/\.md$/, '').split('/').pop() || 'untitled'

      await prisma.card.upsert({
        where: { vaultId_path: { vaultId, path: filePath } },
        create: { vaultId, path: filePath, content, type, title },
        update: { content, type, title, updatedAt: new Date() },
      })

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async deleteFile(filePath: string): Promise<DeleteResult> {
    try {
      const vaultId = await this.getVaultId()
      if (!vaultId) return { success: false, error: 'Vault not found' }

      await prisma.card.deleteMany({
        where: { vaultId, path: filePath },
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
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
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async ensureDir(_dirPath: string): Promise<WriteResult> {
    // 数据库无目录概念，自动存在
    return { success: true }
  }

  async rename(oldPath: string, newPath: string): Promise<WriteResult> {
    try {
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
    } catch (err: any) {
      return { success: false, error: err.message }
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
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}
