import { createAuthClient } from "better-auth/react"
import { getAuthUrl } from "./site-url"

export const authClient = createAuthClient({
  baseURL: getAuthUrl(),
  fetchOptions: {
    credentials: "include",
  },
})

export const { signIn, signUp, signOut, useSession } = authClient
