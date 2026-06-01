// Proxy setup MUST be first — Node's fetch doesn't honor HTTP_PROXY by default
import '@/lib/proxy-setup'

// Catch unhandled promise rejections from pi-ai dynamic requires (node:fs etc.)
// so they don't crash the dev server process.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes('node:fs') || msg.includes('node:os') || msg.includes('node:path')) {
    return // pi-ai webpack context — harmless, don't crash
  }
  console.warn('[unhandledRejection]', reason)
})

import api from '@/server/api'
// import api from '@/server/openapi'
import { handle } from 'hono/vercel'

const handler = handle(api)

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as PATCH,
}
