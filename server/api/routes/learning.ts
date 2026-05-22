/**
 * Learning API Routes
 */
import { Hono } from 'hono';

const app = new Hono()

// GET /api/learning/profile — Get user learning profile
app.get('/profile', async (c) => {
  return c.json({ success: true, message: 'Learning endpoint ready' })
})

// POST /api/learning/memory — Search/retrieve memories
app.post('/memory', async (c) => {
  return c.json({ success: true, message: 'Memory endpoint ready' })
})

export default app
