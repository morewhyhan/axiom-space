/**
 * Session API Routes
 */
import { Hono } from 'hono';

const app = new Hono()

app.get('/', async (c) => {
  return c.json({ success: true, sessions: [] })
})

app.get('/:id', async (c) => {
  const id = c.req.param('id')
  return c.json({ success: true, session: { id } })
})

app.delete('/:id', async (c) => {
  return c.json({ success: true })
})

export default app
