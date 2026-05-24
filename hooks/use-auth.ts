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
      const { data: session } = await authClient.getSession()
      if (session) queryClient.setQueryData(['session'], session)
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
      const { data: session } = await authClient.getSession()
      if (session) queryClient.setQueryData(['session'], session)
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
      queryClient.setQueryData(['session'], null)
      window.location.reload()
      toast.success('已登出')
    },
    onError: (error: Error) => {
      toast.error(error.message || '登出失败')
    },
  })
}
