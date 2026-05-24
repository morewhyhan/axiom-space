'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'

interface LearningSession {
  id: string
  domain: string
  concept: string
  status: string
  phase: string
  outcome: string | null
  createdAt: string
  updatedAt: string
  messageCount: number
}

export function useSession() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await client.api.sessions.$get()
      const data = await res.json()
      if (data.success) return (data.sessions ?? []) as LearningSession[]
      return [] as LearningSession[]
    },
  })

  const createSession = useMutation({
    mutationFn: async (input: { domain: string; concept: string; status?: string; phase?: string }) => {
      const res = await client.api.sessions.$post({ json: input })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Failed to create session')
      return data.session
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (error) => {
      console.error('创建会话失败:', error)
    },
  })

  const updateSession = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; status?: string; phase?: string; outcome?: string }) => {
      const res = await client.api.sessions[':id'].$put({
        param: { id },
        json: data,
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error || 'Failed to update session')
      return result.session
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (error) => {
      console.error('更新会话失败:', error)
    },
  })

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      await client.api.sessions[':id'].$delete({ param: { id } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (error) => {
      console.error('删除会话失败:', error)
    },
  })

  return {
    sessions: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    createSession,
    updateSession,
    deleteSession,
  }
}
