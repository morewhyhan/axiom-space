import { authClient, signIn, signUp, signOut, useSession } from '@/lib/auth-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useAuthSession() {
  return useSession()
}

export function useSignIn() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const response = await signIn.email({ email, password })
      if (response.error) {
        throw new Error(response.error.message || '登录失败')
      }
      return response
    },
    onSuccess: async () => {
      // better-auth's useSession() owns its own internal query key — we cannot
      // safely setQueryData(['session'], …) on the global QueryClient and expect
      // the hook to pick it up. Invalidate broadly so any session-aware query
      // re-fetches and the hook's own subscription reads fresh data.
      await authClient.getSession()
      await queryClient.invalidateQueries()
      toast.success('登录成功')
    },
    onError: (error: Error) => {
      toast.error(error.message || '登录失败，请检查邮箱和密码')
    },
  })
}

export function useSignUp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, password, name }: { email: string; password: string; name?: string }) => {
      const signUpData: { email: string; password: string; name: string } = { email, password, name: name || '' }
      const response = await signUp.email(signUpData)
      if (response.error) {
        throw new Error(response.error.message || '注册失败')
      }
      return response
    },
    onSuccess: async () => {
      await authClient.getSession()
      await queryClient.invalidateQueries()
      toast.success('注册成功')
    },
    onError: (error: Error) => {
      toast.error(error.message || '注册失败，请稍后再试')
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await signOut()
      if (response.error) {
        throw new Error(response.error.message || '登出失败')
      }
      return response
    },
    onSuccess: () => {
      // Toast first, give the user a beat to see it, THEN reload. Calling
      // reload() synchronously after toast() drops the toast on the floor.
      toast.success('已登出')
      queryClient.clear()
      setTimeout(() => {
        window.location.href = '/'
      }, 800)
    },
    onError: (error: Error) => {
      toast.error(error.message || '登出失败')
    },
  })
}
