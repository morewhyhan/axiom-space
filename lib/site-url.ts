/**
 * Single source of truth for the app's public base URL.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_APP_URL (preferred, set in .env.local or hosting provider)
 *  2. VERCEL_URL (auto-set on Vercel deployments)
 *  3. http://localhost:3000 (development fallback)
 *
 * Never returns an empty string and never throws. Safe to call at module
 * load time on both server and client.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`

  return 'http://localhost:3000'
}

/**
 * Better Auth base URL — separate from app URL because deployments may
 * mount auth on a different host or path. Falls back to getSiteUrl().
 */
export function getAuthUrl(): string {
  // Server-side variable takes priority; falls back to public variable
  // (which is what auth-client sees in the browser).
  const explicit =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return getSiteUrl()
}
