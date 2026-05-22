/**
 * GlobalFileStorage — 文件存储单例工厂
 *
 * - 开发/无用户时 → LocalFSAdapter（本地文件系统）
 * - 有用户时      → DbAdapter（Prisma 数据库）
 */

import type { IFileStorage } from './IFileStorage'
import { LocalFSAdapter } from './LocalFSAdapter'
import { DbAdapter } from './DbAdapter'

let _localInstance: IFileStorage | null = null

/** 获取适合当前用户的文件存储 */
export function getFileStorage(userId?: string): IFileStorage {
  if (userId) {
    return new DbAdapter(userId)
  }
  if (!_localInstance) {
    const vaultPath = process.env.VAULT_PATH || './vault'
    _localInstance = new LocalFSAdapter(vaultPath)
  }
  return _localInstance
}
