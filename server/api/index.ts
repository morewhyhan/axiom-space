// Bootstrap browser-style globals (CustomEvent / dispatchEvent shims)
// before any Agent code can fire UI events on the server.
import '@/server/core/safe-globals'

import { Hono } from 'hono';
import { handleError } from './error';
import agentRoutes from './routes/agent';
import learningRoutes from './routes/learning';
import vaultRoutes from './routes/vault';
import vaultMgmtRoutes from './routes/vaults';
import dashboardRoutes from './routes/dashboard';
import galaxyRoutes from './routes/galaxy';
import cognitionRoutes from './routes/cognition';

const app = new Hono().basePath('/api')

// Global error handler
app.onError(handleError)

// Mount route groups
const appWithRoutes = app
  .get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() })
  })
  .route('/agent', agentRoutes)
  .route('/learning', learningRoutes)
  .route('/vault', vaultRoutes)
  .route('/vaults', vaultMgmtRoutes)
  .route('/dashboard', dashboardRoutes)
  .route('/galaxy', galaxyRoutes)
  .route('/cognition', cognitionRoutes)
  // Better Auth handler (keep existing)
  .all('/auth/*', async (c) => {
    const { auth } = await import('@/lib/auth')
    return auth.handler(c.req.raw)
  })

export type AppType = typeof appWithRoutes
export default appWithRoutes
