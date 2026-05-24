/**
 * Dashboard API — 返回真实聚合统计、增长数据、最近活动
 * 支持 ?vid= 指定 vault
 *
 * NOTE: 核心业务逻辑已提取到 server/core/dashboard/index.ts
 * 此文件仅做参数校验和转发（薄层）
 */
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'
import { computeDashboardStats } from '@/server/core/dashboard'

const app = new Hono<{ Variables: { userId: string } }>()

app.use('/*', requireAuth)

app.get('/', async (c) => {
  const userId = c.get('userId') as string
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, stats: { totalNodes: 0, totalEdges: 0, permanent: 0, fleeting: 0, literature: 0, cardsToday: 0, reviewRate: 0, orphanCount: 0, conceptCount: 0, clusters: 0 }, growth: [], recentActivity: [] })

  const data = await computeDashboardStats(vault.id)

  c.header('Cache-Control', 'private, max-age=120')
  return c.json({
    success: true,
    ...data,
  })
})

export default app
