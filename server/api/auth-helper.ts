/**
 * 共享鉴权 & Vault 解析工具
 * 所有路由统一使用，避免重复代码
 */
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { Context } from 'hono'

export async function getUserId(c: Context): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session?.user?.id) return session.user.id
  // 仅在非生产环境且明确配置了 DEV_MODE 时回退
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_MODE === 'true') {
    const fallback = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (fallback) return fallback.id
  }
  return null
}

export async function resolveVault(c: Context, userId: string): Promise<{ id: string; profileCache?: string | null; name?: string; createdAt?: Date; updatedAt?: Date } | null> {
  const vid = c.req.query('vid')
  if (vid) {
    const vault = await prisma.vault.findUnique({ where: { id: vid } })
    if (!vault || vault.userId !== userId) return null
    return vault
  }
  return prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
}
