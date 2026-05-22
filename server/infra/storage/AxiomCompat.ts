/**
 * AxiomCompat — Electron window.axiom 的兼容适配层
 *
 * 工具代码中原本通过 const axiom = window.axiom 调用的 API，
 * 现在全部映射到 IFileStorage + Node.js 原生能力。
 *
 * Agent 代码不需要逐行修改，只需把
 *   const axiom = window.axiom
 * 换成
 *   const axiom = createAxiomCompat(getFileStorage(userId))
 */

import type { IFileStorage } from "./IFileStorage"
import { getFileStorage } from "./GlobalFileStorage"
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface AxiomCompat {
  // 文件操作
  readFile(path: string): Promise<{ success: boolean; content?: string; error?: string }>
  writeFile(path: string, content: string): Promise<{ success: boolean; error?: string }>
  deleteFile(path: string): Promise<{ success: boolean; error?: string }>
  ensureDirectory(path: string): Promise<{ success: boolean; error?: string }>
  ls(dir: string): Promise<{ success: boolean; entries?: any[]; error?: string }>
  rename(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }>
  editFile(path: string, oldStr: string, newStr: string): Promise<{ success: boolean; error?: string }>
  grep(pattern: string, filePath: string): Promise<{ success: boolean; lines?: string[]; error?: string }>
  find(dir: string, pattern: string): Promise<{ success: boolean; files?: string[]; error?: string }>

  // 卡片操作
  createFleeing(vaultPath: string, item: any, content: string, oldTitle?: string): Promise<{ success: boolean; actualTitle?: string }>
  createPermanent(vaultPath: string, item: any, content: string, oldTitle?: string): Promise<{ success: boolean; actualTitle?: string }>
  loadFleeing(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>
  loadPermanent(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>
  loadLiterature(vaultPath: string): Promise<{ success: boolean; data?: any[]; error?: string }>

  // 搜索
  ftsSearch(vaultPath: string, query: string, limit?: number): Promise<{ success: boolean; results?: any[]; error?: string }>

  // 命令执行
  bash(command: string): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>
  webFetch(url: string, maxLength?: number): Promise<{ success: boolean; content?: string; error?: string }>

  // 技能
  skillLoad(name: string): Promise<{ success: boolean; content?: string; error?: string }>

  // 环境
  getEnvConfig(): Record<string, string | undefined>
  getHomeDir(): string
  getCwd(): string
  getCurrentVaultPath(): string
}

export function createAxiomCompat(storage: IFileStorage, vaultPath?: string): AxiomCompat {
  const vp = vaultPath || process.env.VAULT_PATH || './vault'

  return {
    // ── 文件操作 ──
    async readFile(p: string) { return storage.readFile(p) },
    async writeFile(p: string, content: string) { return storage.writeFile(p, content) },
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
      const lines = read.content.split('\n').filter(l => l.includes(pattern))
      return { success: true, lines }
    },

    async find(dir: string, pattern: string) {
      const list = await storage.listDir(dir)
      if (!list.success) return { success: false, error: list.error }
      const files = (list.entries || [])
        .filter(e => !e.isDirectory && e.name.includes(pattern))
        .map(e => e.path)
      return { success: true, files }
    },

    // ── 卡片操作（底层还是 IFileStorage — MD 文件）──
    async createFleeing(_vp: string, item: any, content: string, oldTitle?: string) {
      const title = item.title || item.id || `fleeing-${Date.now()}`
      const filePath = `fleeting/${title}.md`
      if (oldTitle) {
        await storage.deleteFile(`fleeting/${oldTitle}.md`)
      }
      // item 中的 frontmatter 信息直接序列化为 JSON 附加在文件内容中
      const frontmatter = `---\ntitle: ${title}\ncreated: ${item.created || new Date().toISOString()}\ntags: ${JSON.stringify(item.tags || [])}\nsource_type: ${item.source_type || 'user'}\npolish_state: ${item.polish_state || 'raw'}\n---\n\n`
      await storage.writeFile(filePath, frontmatter + content)
      return { success: true, actualTitle: title }
    },

    async createPermanent(_vp: string, item: any, content: string, oldTitle?: string) {
      const title = item.title || `perm-${Date.now()}`
      const filePath = `permanent/${title}.md`
      if (oldTitle) {
        await storage.deleteFile(`permanent/${oldTitle}.md`)
      }
      const frontmatter = `---\ntitle: ${title}\ncreated: ${item.created || new Date().toISOString()}\n---\n\n`
      await storage.writeFile(filePath, frontmatter + content)
      return { success: true, actualTitle: title }
    },

    async loadFleeing(_vp: string) {
      const list = await storage.listDir('fleeting')
      if (!list.success || !list.entries) return { success: true, data: [] }
      const data = []
      for (const entry of list.entries) {
        if (!entry.isDirectory) {
          const read = await storage.readFile(entry.path)
          data.push({ title: entry.name.replace(/\.md$/, ''), content: read.content || '', cardPath: entry.path })
        }
      }
      return { success: true, data }
    },

    async loadPermanent(_vp: string) {
      const list = await storage.listDir('permanent')
      if (!list.success || !list.entries) return { success: true, data: [] }
      const data = []
      for (const entry of list.entries) {
        if (!entry.isDirectory) {
          const read = await storage.readFile(entry.path)
          data.push({ title: entry.name.replace(/\.md$/, ''), content: read.content || '', cardPath: entry.path })
        }
      }
      return { success: true, data }
    },

    async loadLiterature(_vp: string) {
      const list = await storage.listDir('literature')
      if (!list.success || !list.entries) return { success: true, data: [] }
      const data = []
      for (const entry of list.entries) {
        if (!entry.isDirectory) {
          const read = await storage.readFile(entry.path)
          data.push({ title: entry.name.replace(/\.md$/, ''), content: read.content || '', cardPath: entry.path })
        }
      }
      return { success: true, data }
    },

    async ftsSearch(_vp: string, query: string, _limit?: number) {
      // 利用 IFileStorage 的 search 方法递归搜索
      return storage.search(query)
    },

    // ── 命令执行 ──
    async bash(command: string) {
      try {
        const stdout = execSync(command, { encoding: 'utf-8', timeout: 30000 })
        return { success: true, stdout: stdout.trim(), stderr: '' }
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
      // fallback: 从内置 skills 目录读
      const builtin = await storage.readFile(`.axiom/skills/${name}.md`)
      return builtin
    },

    getEnvConfig() { return process.env as Record<string, string | undefined> },
    getHomeDir() { return process.env.HOME || '/home/user' },
    getCwd() { return process.cwd() },
    getCurrentVaultPath() { return vp },
  }
}
