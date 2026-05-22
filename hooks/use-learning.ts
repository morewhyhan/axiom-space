'use client'

import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'

export function useLearning() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res: any = await (client as any).api.learning.profile.$get();
        const data: any = await res.json();
        setProfile(data);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [])

  return { profile, loading }
}
