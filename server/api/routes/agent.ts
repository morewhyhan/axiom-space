/**
 * Agent API Routes
 * Thin Hono controllers that delegate to server/core/agent/
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@/server/api/validator';
import { createServerAgentServices } from '@/server/infra/factories/AgentServicesFactory';

const app = new Hono()

// POST /api/agent/chat — Send a message to the agent
app.post('/chat', zValidator('json', z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  oracleId: z.string().optional(),
})), async (c) => {
  const { message } = c.req.valid('json')

  // 创建 Agent 服务（自动注入 LocalFSAdapter 到 vault 目录）
  const { infrastructure } = createServerAgentServices({
    vaultPath: process.env.VAULT_PATH || './vault',
  })

  // 后续: const agent = new AxiomAgent(infrastructure, ...)
  // 现在暂用 echo 演示
  return c.json({
    success: true,
    data: {
      reply: `收到: ${message}（Agent 已具备文件读写能力，可通过 infrastructure.fileStorage 操作 vault）`,
    },
  })
})

// GET /api/agent/health — Agent health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

export default app
