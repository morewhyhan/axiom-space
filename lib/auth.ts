import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "./db"
import { getAuthUrl } from "./site-url"

// In production a secret MUST be set. In dev we fall back to a fixed
// development-only string so the app can boot without configuration —
// but warn loudly so the user sees they need to set it before shipping.
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error(
          '[auth] BETTER_AUTH_SECRET is required in production. ' +
          'Generate one with: openssl rand -hex 32'
        )
      })()
    : 'dev-only-insecure-secret-do-not-use-in-production')

if (process.env.NODE_ENV !== 'production' && !process.env.BETTER_AUTH_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] BETTER_AUTH_SECRET is not set — using a dev-only fallback. ' +
    'Set it in .env.local before running in production.'
  )
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  secret: authSecret,
  baseURL: getAuthUrl(),
  advanced: {
    cookiePrefix: "hononext",
    crossSubDomainCookies: {
      enabled: false,
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }: any) => {
      console.log("Send reset password email to", user.email, url)
    },
    sendVerificationEmail: async ({ user, url }: any) => {
      console.log("Send verification email to", user.email, url)
    },
  },
})
