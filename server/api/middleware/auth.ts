import { createMiddleware } from 'hono/factory'
import { getUserId } from '../auth-helper'

/**
 * requireAuth — Unified auth middleware
 *
 * Extracts userId from the request (Better Auth session) and sets it on context.
 * If no valid session, returns 401 JSON response.
 *
 * Usage:
 *   app.get('/path', requireAuth, async (c) => {
 *     const userId = c.get('userId')
 *     // ...
 *   })
 */
export const requireAuth = createMiddleware<{ Variables: { userId: string } }>(async (c, next) => {
  const userId = await getUserId(c)
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  c.set('userId', userId)
  await next()
})
