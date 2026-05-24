/**
 * 共享鉴权 & Vault 解析工具
 * 所有路由统一使用，避免重复代码
 */
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function getUserId(c: any): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session?.user?.id) return session.user.id
  if (process.env.NODE_ENV === 'development') {
    const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return firstUser?.id || null
  }
  return null
}

export async function resolveVault(c: any, userId: string): Promise<{ id: string } | null> {
  const vid = c.req.query('vid')
  if (vid) {
    const vault = await prisma.vault.findUnique({ where: { id: vid } })
    if (!vault || vault.userId !== userId) return null
    return vault
  }
  return prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
}
