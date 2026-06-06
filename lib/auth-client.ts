import { createAuthClient } from "better-auth/react"
import { getAuthUrl } from "./site-url"

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : getAuthUrl(),
  fetchOptions: {
    credentials: "include",
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
