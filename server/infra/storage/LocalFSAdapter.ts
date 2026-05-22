/**
 * LocalFSAdapter — 基于 Node.js fs 的文件存储实现
 *
 * 服务端 Agent 通过此适配器读写服务器文件系统，
 * 和 Electron 端的 window.axiom 调用保持相同的能力。
 *
 * 用法：
 *   const storage = new LocalFSAdapter('/data/vault')
 *   await storage.readFile('literature/涌现.md')
 */

import fs from 'fs'
import path from 'path'
import type { IFileStorage, ReadResult, WriteResult, ListResult, DeleteResult, SearchResult, FileEntry } from './IFileStorage'

export class LocalFSAdapter implements IFileStorage {
  constructor(private rootPath: string) {
    this.ensureDir('')
  }

  /** 解析安全路径（防止路径穿越） */
  private resolvePath(filePath: string): string {
    // 去掉前导斜杠，防止路径穿越
    const safe = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '')
    const fullPath = path.join(this.rootPath, safe)
    // 确保没有跳出 rootPath
    if (!fullPath.startsWith(this.rootPath)) {
      throw new Error(`Path traversal denied: ${filePath}`)
    }
    return fullPath
  }

  async readFile(filePath: string): Promise<ReadResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      const content = fs.readFileSync(fullPath, 'utf-8')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async writeFile(filePath: string, content: string): Promise<WriteResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      // 确保父目录存在
      const dir = path.dirname(fullPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(fullPath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async appendFile(filePath: string, content: string): Promise<WriteResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      const dir = path.dirname(fullPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.appendFileSync(fullPath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async deleteFile(filePath: string): Promise<DeleteResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async listDir(dirPath: string): Promise<ListResult> {
    try {
      const fullPath = this.resolvePath(dirPath)
      if (!fs.existsSync(fullPath)) {
        return { success: true, entries: [] }
      }
      const items = fs.readdirSync(fullPath, { withFileTypes: true })
      const entries: FileEntry[] = items.map((item) => {
        const stat = fs.statSync(path.join(fullPath, item.name))
        return {
          name: item.name,
          path: path.join(dirPath, item.name),
          isDirectory: item.isDirectory(),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        }
      })
      return { success: true, entries }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async ensureDir(dirPath: string): Promise<WriteResult> {
    try {
      const fullPath = this.resolvePath(dirPath)
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async rename(oldPath: string, newPath: string): Promise<WriteResult> {
    try {
      const fullOld = this.resolvePath(oldPath)
      const fullNew = this.resolvePath(newPath)
      const dir = path.dirname(fullNew)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.renameSync(fullOld, fullNew)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async search(query: string, rootPath?: string): Promise<SearchResult> {
    try {
      const searchDir = rootPath ? this.resolvePath(rootPath) : this.rootPath
      const results: Array<{ path: string; title: string; snippet: string; score: number }> = []
      const lowerQuery = query.toLowerCase()

      // 递归搜索 .md 文件
      const walkDir = (dir: string) => {
        let items: fs.Dirent[]
        try {
          items = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const item of items) {
          const fullPath = path.join(dir, item.name)
          if (item.isDirectory() && !item.name.startsWith('.')) {
            walkDir(fullPath)
          } else if (item.name.endsWith('.md')) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (content.toLowerCase().includes(lowerQuery)) {
                // 找到匹配行作为 snippet
                const lines = content.split('\n')
                const matchedLine = lines.find(l => l.toLowerCase().includes(lowerQuery)) || ''
                const relativePath = path.relative(this.rootPath, fullPath)
                const title = item.name.replace(/\.md$/, '')
                results.push({
                  path: relativePath,
                  title,
                  snippet: matchedLine.trim().slice(0, 200),
                  score: 1,
                })
              }
            } catch { /* skip unreadable */ }
          }
        }
      }

      walkDir(searchDir)
      return { success: true, results }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}
