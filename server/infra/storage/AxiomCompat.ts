/**
 * AxiomCompat — Electron window.axiom 的兼容适配层
 *
 * 工具代码中原本通过 const axiom = window.axiom 调用的 API，
 * 现在全部映射到 IFileStorage + Prisma + Node.js 原生能力。
 * DB 模式下卡片操作直接走 Prisma 查询，不写 YAML frontmatter。
 */

import type { IFileStorage } from "./IFileStorage"
import { exec } from 'child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { validatePermanentCardContent } from '@/server/core/domain/contracts'

const asyncExec = promisify(exec)

export interface AxiomCompat {
  readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }>
  writeFile(path: string, content: string, type?: string): Promise<{ success: boolean; error?: string }>
  deleteFile(path: string): Promise<{ success: boolean; error?: string }>
  ensureDirectory(path: string): Promise<{ success: boolean; error?: string }>
  ls(dir: string): Promise<{ success: boolean; entries?: any[]; error?: string }>
  rename(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>
  editFile(path: string, oldStr: string, newStr: string): Promise<{ success: boolean; error?: string }>
  grep(pattern: string, filePath: string): Promise<{ success: boolean; lines?: string[]; matches?: Array<{ line: number; content: string }>; count?: number; error?: string }>
  find(dir: string, pattern: string): Promise<{ success: boolean; files?: string[]; count?: number; error?: string }>
  loadCard(vaultPath: string, cardPath: string): Promise<{ success: boolean; card?: any; error?: string }>
  updateCard(vaultPath: string, cardPath: string, card: any, content: string): Promise<{ success: boolean; error?: string }>

  createFleeing(vaultPath: string, item: any, content: string, oldTitle?: string): Promise<{ success: boolean; actualTitle?: string }>
  createPermanent(vaultPath: string, item: any, content: string, oldTitle?: string): Promise<{ success: boolean; actualTitle?: string }>
  loadFleeing(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>
  loadPermanent(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>
  loadLiterature(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>

  ftsSearch(vaultPath: string, query: string, limit?: number): Promise<{ success: boolean; results?: any[]; error?: string }>
  bash(command: string): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>
  webFetch(url: string, maxLength?: number): Promise<{ success: boolean; content?: string; error?: string }>
  skillLoad(name: string): Promise<{ success: boolean; content?: string; error?: string }>
  getEnvConfig(): Record<string, string | undefined>
  getHomeDir(): string
  getCwd(): string
  getCurrentVaultPath(): string
}

export function createAxiomCompat(storage: IFileStorage, vaultPath?: string): AxiomCompat {
  const vp = vaultPath || process.env.VAULT_PATH || ''

  return {
    // ── 文件操作 ──
    async readFile(p: string) { return storage.readFile(p) },
    async writeFile(p: string, content: string, type?: string) { return storage.writeFile(p, content, type) },
    async deleteFile(p: string) { return storage.deleteFile(p) },
    async ensureDirectory(p: string) { return storage.ensureDir(p) },
    async ls(dir: string) { return storage.listDir(dir) },
    async rename(oldP: string, newP: string) { return storage.rename(oldP, newP) },

    async editFile(p: string, oldStr: string, newStr: string) {
      const read = await storage.readFile(p)
      if (!read.success || !read.content) return { success: false, error: read.error || 'File not found' }
      const updated = read.content.replace(oldStr, newStr)
      return storage.writeFile(p, updated)
    },

    async grep(pattern: string, filePath: string) {
      const read = await storage.readFile(filePath)
      if (!read.success || !read.content) return { success: false, error: read.error }
      let matcher: RegExp | null = null
      try {
        matcher = new RegExp(pattern, 'i')
      } catch {
        matcher = null
      }
      const matches = read.content
        .split('\n')
        .map((content, index) => ({ line: index + 1, content }))
        .filter(({ content }) => matcher ? matcher.test(content) : content.includes(pattern))
      return { success: true, lines: matches.map((m) => m.content), matches, count: matches.length }
    },

    async find(dir: string, pattern: string) {
      const list = await storage.listDir(dir)
      if (!list.success) return { success: false, error: list.error }
      let matcher: RegExp | null = null
      try {
        matcher = new RegExp(pattern, 'i')
      } catch {
        matcher = null
      }
      const files = (list.entries || [])
        .filter(e => !e.isDirectory && (matcher ? matcher.test(e.name) : e.name.includes(pattern)))
        .map(e => e.path)
      return { success: true, files, count: files.length }
    },

    async loadCard(_vp: string, cardPath: string) {
      const read = await storage.readFile(cardPath)
      if (!read.success) return { success: false, error: read.error || 'Card not found' }

      const { prisma } = await import('@/lib/db')
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      const dbCard = vid
        ? await prisma.card.findUnique({ where: { vaultId_path: { vaultId: vid, path: cardPath } } })
        : null
      const content = read.content || dbCard?.content || ''
      const wikilinks = Array.from(content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g))
        .map((match) => match[1]?.trim())
        .filter(Boolean)
      return {
        success: true,
        card: {
          ...(dbCard || {}),
          path: cardPath,
          title: dbCard?.title || cardPath.split('/').pop()?.replace(/\.md$/, '') || '',
          content,
          links: { to: Array.from(new Set(wikilinks)), from: [] },
        },
      }
    },

    async updateCard(_vp: string, cardPath: string, card: any, content: string) {
      let nextContent = content || card?.content || ''
      const outgoing = Array.isArray(card?.links?.to) ? card.links.to : []
      for (const target of outgoing) {
        const cleanTarget = String(target || '').trim()
        if (!cleanTarget) continue
        const linkPattern = new RegExp(`\\[\\[${cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]+)?\\]\\]`)
        if (!linkPattern.test(nextContent)) {
          nextContent += `${nextContent.endsWith('\n') ? '' : '\n'}\n[[${cleanTarget}]]`
        }
      }
      return storage.writeFile(cardPath, nextContent, card?.type)
    },

    // ── 卡片操作（DB 直查，不写 YAML frontmatter）──
    async createFleeing(_vp: string, item: any, content: string, oldTitle?: string) {
      const title = item.title || item.id || `fleeing-${Date.now()}`
      const filePath = `fleeting/${title}.md`
      if (oldTitle) await storage.deleteFile(`fleeting/${oldTitle}.md`)
      await storage.writeFile(filePath, content, 'fleeting')
      // 同步写入 Prisma DB
      const { prisma } = await import('@/lib/db')
      const { getCurrentUserId, getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const { emitDomainEvent } = await import('@/server/core/domain/events')
      const vid = getCurrentVaultId()
      if (vid) {
        const tags = item.tags ? (Array.isArray(item.tags) ? JSON.stringify(item.tags) : item.tags) : null
        const card = await prisma.card.upsert({
          where: { vaultId_path: { vaultId: vid, path: filePath } },
          update: { title, content, type: 'fleeting', tags, updatedAt: new Date() },
          create: { vaultId: vid, path: filePath, title, content, type: 'fleeting', tags },
        })
        void emitDomainEvent({
          userId: getCurrentUserId(),
          vaultId: vid,
          aggregateType: 'card',
          aggregateId: card.id,
          eventType: 'CardCreated',
          payload: { path: filePath, title, type: 'fleeting', source: 'agentTool' },
        })
        console.log('[AxiomCompat] createFleeing DB write OK:', { id: card.id, title, vaultId: vid })
        return { success: true, actualTitle: title, id: card.id, cardPath: filePath }
      }
      console.warn('[AxiomCompat] createFleeing: getCurrentVaultId() returned undefined, skipping Prisma write')
      return { success: true, actualTitle: title }
    },

    async createPermanent(_vp: string, item: any, content: string, oldTitle?: string) {
      const quality = validatePermanentCardContent(content)
      if (!quality.passed) {
        const { getCurrentUserId, getCurrentVaultId } = await import('@/server/core/agent/agent-context')
        const { recordPromotionAttempt } = await import('@/server/core/domain/events')
        const vid = getCurrentVaultId()
        if (vid) {
          void recordPromotionAttempt({
            userId: getCurrentUserId(),
            vaultId: vid,
            toType: 'permanent',
            status: 'rejected',
            missingElements: quality.missingElements,
            qualityChecks: quality.checks,
          })
        }
        return {
          success: false,
          error: `PROMOTION_CRITERIA_FAILED: missing ${quality.missingElements.join(', ')}`,
          missingElements: quality.missingElements,
          qualityChecks: quality.checks,
          qualityIssues: quality.issues,
        }
      }
      const title = item.title || `perm-${Date.now()}`
      const filePath = `permanent/${title}.md`
      if (oldTitle) {
        const { prisma } = await import('@/lib/db')
        const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
        const vid = getCurrentVaultId()
        if (vid) {
          await prisma.card.deleteMany({ where: { vaultId: vid, path: `permanent/${oldTitle}.md` } })
        }
        await storage.deleteFile(`permanent/${oldTitle}.md`)
      }
      // 写入文件存储
      await storage.writeFile(filePath, content, 'permanent')
      // 同步写入 Prisma DB
      const { prisma } = await import('@/lib/db')
      const { getCurrentUserId, getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const { emitDomainEvent, recordPromotionAttempt } = await import('@/server/core/domain/events')
      const vid = getCurrentVaultId()
      if (vid) {
        const tags = item.tags ? (Array.isArray(item.tags) ? JSON.stringify(item.tags) : item.tags) : null
        const card = await prisma.card.upsert({
          where: { vaultId_path: { vaultId: vid, path: filePath } },
          update: { title, content, type: 'permanent', tags, updatedAt: new Date() },
          create: { vaultId: vid, path: filePath, title, content, type: 'permanent', tags },
        })
        void emitDomainEvent({
          userId: getCurrentUserId(),
          vaultId: vid,
          aggregateType: 'card',
          aggregateId: card.id,
          eventType: 'CardCreated',
          payload: { path: filePath, title, type: 'permanent', source: 'agentTool' },
        })
        void recordPromotionAttempt({
          userId: getCurrentUserId(),
          vaultId: vid,
          cardId: card.id,
          toCardId: card.id,
          toType: 'permanent',
          status: 'accepted',
        })
        console.log('[AxiomCompat] createPermanent DB write OK:', { id: card.id, title, vaultId: vid })
        return { success: true, actualTitle: title, id: card.id, cardPath: filePath }
      }
      console.warn('[AxiomCompat] createPermanent: getCurrentVaultId() returned undefined, skipping Prisma write')
      return { success: true, actualTitle: title }
    },

    async loadFleeing(_vp: string) {
      const { prisma } = await import('@/lib/db')
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return { success: true, data: [] }
      const cards = await prisma.card.findMany({ where: { vaultId: vid, type: 'fleeting' }, select: { id: true, title: true, content: true, path: true } })
      return { success: true, data: cards.map(c => ({ id: c.id, title: c.title || '', content: c.content || '', cardPath: c.path })) }
    },

    async loadPermanent(_vp: string) {
      const { prisma } = await import('@/lib/db')
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return { success: true, data: [] }
      const cards = await prisma.card.findMany({ where: { vaultId: vid, type: 'permanent' }, select: { id: true, title: true, content: true, path: true } })
      return { success: true, data: cards.map(c => ({ id: c.id, title: c.title || '', content: c.content || '', cardPath: c.path })) }
    },

    async loadLiterature(_vp: string) {
      const { prisma } = await import('@/lib/db')
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return { success: true, data: [] }
      const cards = await prisma.card.findMany({ where: { vaultId: vid, type: 'literature' }, select: { id: true, title: true, content: true, path: true } })
      return { success: true, data: cards.map(c => ({ id: c.id, title: c.title || '', content: c.content || '', cardPath: c.path })) }
    },

    async ftsSearch(_vp: string, query: string, _limit?: number) {
      return storage.search(query)
    },

    // ── 命令执行 ──
    async bash(command: string) {
      try {
        const { stdout, stderr } = await asyncExec(command, { encoding: 'utf-8', timeout: 30000 })
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() }
      } catch (e: any) {
        return { success: false, stdout: e.stdout?.toString?.() || '', stderr: e.stderr?.toString?.() || '', error: e.message }
      }
    },

    async webFetch(url: string, maxLength?: number) {
      try {
        const res = await fetch(url)
        let text = await res.text()
        if (maxLength && text.length > maxLength) text = text.slice(0, maxLength)
        return { success: true, content: text }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    },

    async skillLoad(name: string) {
      const read = await storage.readFile(`skills/${name}/SKILL.md`)
      if (read.success) return read
      const builtin = await storage.readFile(`.axiom/skills/${name}.md`)
      return builtin
    },

    getEnvConfig() { return process.env as Record<string, string | undefined> },
    getHomeDir() { return homedir() },
    getCwd() { return process.cwd() },
    getCurrentVaultPath() { return vp },
  }
}
