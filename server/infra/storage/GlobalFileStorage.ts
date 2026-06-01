/**
 * GlobalFileStorage — 文件存储单例工厂（纯数据库模式）
 *
 * 始终返回 DbAdapter，不再有文件系统路由。
 * 通过 AsyncLocalStorage 上下文自动获取当前 userId。
 */

import type { IFileStorage } from './IFileStorage'
import { DbAdapter } from './DbAdapter'

const cache = new Map<string, DbAdapter>()

/** 获取当前用户的文件存储（纯数据库模式） */
export function getFileStorage(userId?: string): IFileStorage {
  const uid = userId
  if (uid) {
    let cached = cache.get(uid)
    if (!cached) {
      cached = new DbAdapter(uid)
      cache.set(uid, cached)
    }
    return cached
  }
  // 无 userId 时创建一个临时的（内部通过 getCurrentUserId() 自动获取）
  return new DbAdapter('')
}
