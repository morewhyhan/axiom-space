import { hc } from 'hono/client'
import type { AppType } from '@/server/api'
import { getSiteUrl } from './site-url'

const baseUrl = getSiteUrl()

/**
 * Hono RPC client with full type inference.
 */
export const client = hc<AppType>(baseUrl)
