/**
 * GlobalFileStorage — 文件存储单例工厂
 *
 * - 显式传 userId        → DbAdapter（直接绑定该用户）
 * - 未传 userId          → ContextualFileStorage（运行时根据
 *                          AsyncLocalStorage 上下文路由到 DbAdapter
 *                          或 LocalFSAdapter）
 *
 * 这样工具文件里的 `const fs = getFileStorage()` 模块级常量也能在
 * 每次调用时拿到正确用户的存储，无需修改调用点。
 */

import type { IFileStorage } from './IFileStorage'
import { DbAdapter } from './DbAdapter'
import { ContextualFileStorage } from './ContextualFileStorage'

let _contextual: IFileStorage | null = null

/** 获取适合当前用户的文件存储 */
export function getFileStorage(userId?: string): IFileStorage {
  if (userId) {
    return new DbAdapter(userId)
  }
  if (!_contextual) {
    _contextual = new ContextualFileStorage()
  }
  return _contextual
}
