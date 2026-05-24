/**
 * Browser-style global polyfills for Node.js server context.
 *
 * Background:
 *   The Agent tool layer evolved from an Electron renderer where
 *   `globalThis.dispatchEvent` / `CustomEvent` / `addEventListener`
 *   were always available (jsdom-like). In a pure Node.js server
 *   process those globals are undefined and any tool that fires a
 *   UI event would throw.
 *
 * Strategy:
 *   Provide silent no-op fallbacks so the existing dispatch sites keep
 *   working without changes. The dispatched events are server-side
 *   side-effects — they don't propagate to the browser anyway, so a
 *   no-op is semantically correct.
 *
 * Import once from server entry points (server/api/index.ts).
 */

const g: any = globalThis

if (typeof g.dispatchEvent !== 'function') {
  g.dispatchEvent = (_event: unknown) => true
}

if (typeof g.addEventListener !== 'function') {
  g.addEventListener = (_type: string, _listener: unknown) => {}
}

if (typeof g.removeEventListener !== 'function') {
  g.removeEventListener = (_type: string, _listener: unknown) => {}
}

if (typeof g.CustomEvent !== 'function') {
  // Node 19+ ships CustomEvent natively. Older runtimes need this shim.
  g.CustomEvent = class CustomEvent<T = unknown> {
    readonly type: string
    readonly detail: T | undefined
    constructor(type: string, init?: { detail?: T }) {
      this.type = type
      this.detail = init?.detail
    }
  }
}

export {}
