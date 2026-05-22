import { Hono } from 'hono';
import { handleError } from './error';
import agentRoutes from './routes/agent';
import learningRoutes from './routes/learning';
import sessionRoutes from './routes/session';
import vaultRoutes from './routes/vault';

const app = new Hono().basePath('/api')

// Global error handler
app.onError(handleError)

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

// Mount route groups
app.route('/agent', agentRoutes)
app.route('/learning', learningRoutes)
app.route('/sessions', sessionRoutes)
app.route('/vault', vaultRoutes)

// Better Auth handler (keep existing)
app.all('/auth/*', async (c) => {
  const { auth } = await import('@/lib/auth')
  return auth.handler(c.req.raw)
})

export type AppType = typeof app
export default app
