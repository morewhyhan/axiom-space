/**
 * IFileStorage — 文件存储接口
 *
 * Agent 的所有文件操作都通过此接口，不直接依赖 fs 或 window.axiom。
 * - 桌面端（Electron）：实现为 LocalFSAdapter（调 fs）
 * - 网页端（Next.js 服务端）：同样实现为 LocalFSAdapter（调 fs）
 * - 两边 Agent 工具代码完全一致
 */

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  updatedAt?: string
}

export interface ReadResult {
  success: boolean
  content?: string
  error?: string
}

export interface WriteResult {
  success: boolean
  error?: string
}

export interface ListResult {
  success: boolean
  entries?: FileEntry[]
  error?: string
}

export interface DeleteResult {
  success: boolean
  error?: string
}

export interface SearchResult {
  success: boolean
  results?: Array<{ path: string; title: string; snippet: string; score: number }>
  error?: string
}

export interface IFileStorage {
  /** 读取文件内容（返回纯文本）。可传入 vaultId 指定目标 Vault */
  readFile(path: string, vaultId?: string): Promise<ReadResult>

  /** 写入文件内容（覆盖） */
  writeFile(path: string, content: string, cardType?: string): Promise<WriteResult>

  /** 删除文件 */
  deleteFile(path: string): Promise<DeleteResult>

  /** 列出目录下的文件和文件夹 */
  listDir(path: string): Promise<ListResult>

  /** 确保目录存在（递归创建） */
  ensureDir(path: string): Promise<WriteResult>

  /** 重命名/移动文件 */
  rename(oldPath: string, newPath: string): Promise<WriteResult>

  /** 全文搜索（在 vault 范围内搜索文件内容） */
  search(query: string, rootPath?: string): Promise<SearchResult>

  /** 读取文件信息的元数据 */
  stat?(path: string): Promise<{ success: boolean; entry?: FileEntry; error?: string }>
}
