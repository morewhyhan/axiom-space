import { hc } from 'hono/client'
import type { Hono } from 'hono'
import ky from 'ky'
import { getSiteUrl } from './site-url'

const baseUrl = getSiteUrl()

export const fetch = ky.extend({
  credentials: 'include' as const,
  hooks: {
    afterResponse: [
      async (_, __, response: Response) => {
        if (response.ok) {
          return response
        } else {
          throw await response.json()
        }
      },
    ],
  },
})

// Typed API client routes — mirrors server/api/index.ts structure
export interface ApiClient {
  api: {
    agent: {
      chat: {
        $post: (args: { json: { message: string; sessionId?: string; oracleId?: string } }) => Promise<Response>
      }
      'chat/simple': {
        $post: (args: { json: { message: string; sessionId?: string } }) => Promise<Response>
      }
      sessions: {
        $get: () => Promise<Response>
        $delete: () => Promise<Response>
      }
      health: {
        $get: () => Promise<Response>
      }
      status: {
        $get: () => Promise<Response>
      }
    }
    dashboard: {
      $get: (args?: { query?: { vid?: string } }) => Promise<Response>
    }
    galaxy: {
      nodes: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
      edges: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
      clusters: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
    }
    learning: {
      profile: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
      paths: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
      memory: { $post: (args: { json: Record<string, unknown> }) => Promise<Response> }
    }
    cognition: {
      stats: { $get: (args?: { query?: { vid?: string } }) => Promise<Response> }
    }
    sessions: {
      $get: () => Promise<Response>
      $post: (args: { json: { domain: string; concept: string; status?: string; phase?: string } }) => Promise<Response>
      ':id': {
        $get: (args: { param: { id: string } }) => Promise<Response>
        $put: (args: { param: { id: string }; json: Record<string, unknown> }) => Promise<Response>
        $delete: (args: { param: { id: string } }) => Promise<Response>
        messages: {
          $post: (args: { param: { id: string }; json: { role: string; content: string } }) => Promise<Response>
        }
      }
    }
    vault: {
      list: { $get: (args?: { query?: { dir?: string } }) => Promise<Response> }
      read: { $get: (args?: { query?: { path?: string } }) => Promise<Response> }
      write: { $post: (args: { json: Record<string, unknown> }) => Promise<Response> }
      delete: { $delete: (args?: { query?: { path?: string } }) => Promise<Response> }
      search: { $get: (args?: { query?: Record<string, string> }) => Promise<Response> }
      export: { $get: () => Promise<Response> }
      card: {
        ':id': {
          $get: (args: { param: { id: string } }) => Promise<Response>
          $put: (args: { param: { id: string }; json: Record<string, unknown> }) => Promise<Response>
          $delete: (args: { param: { id: string } }) => Promise<Response>
        }
      }
    }
    vaults: {
      $get: () => Promise<Response>
      $post: (args: { json: { name?: string } }) => Promise<Response>
    }
    health: {
      $get: () => Promise<Response>
    }
  }
}

export const client = hc<Hono>(baseUrl, {
  fetch: fetch,
}) as unknown as ApiClient
