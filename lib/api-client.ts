import { hc } from 'hono/client'
import type { AppType } from '@/server/api'
import { getSiteUrl } from './site-url'

const baseUrl = getSiteUrl()

/**
 * Hono RPC client.
 *
 * The `hc<AppType>()` generic carries the full route type information, but
 * the nested `UnionToIntersection<Client<AppType>>` resolution fails under
 * our current TypeScript setup (moduleResolution: bundler + strict).
 *
 * Instead we pass the baseUrl without the generic and annotate manually to
 * retain nominal type compatibility via the `as unknown` double-cast.
 * Individual call sites (hooks) remain duck-typed — they access properties
 * like `client.api.xxx.$get()` which resolve at runtime regardless.
 */
export const client = hc(baseUrl) as unknown as ReturnType<typeof hc<AppType>>
