import { useQuery } from '@tanstack/react-query'
import { healthSchema } from '@repo/shared/schemas'
import type { Health } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'
import { ApiError } from '@/lib/api-error.ts'

export const HEALTH_QUERY_KEY = ['health', 'report'] as const

const HEALTH_POLL_INTERVAL_MS = 10_000

// Hook to call GET /health and keep the per-dependency report fresh by polling
export function useHealth() {
  return useQuery<Health>({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: async () => {
      try {
        const response = await apiClient<unknown>('/health')
        return healthSchema.parse(response)
      } catch (error) {
        // A 503 still carries the report: it only says a critical dependency is down
        if (error instanceof ApiError) {
          const report = healthSchema.safeParse(error.details)
          if (report.success) return report.data
        }
        throw error
      }
    },
    refetchInterval: HEALTH_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true, // Coming back to the tab shows the current state at once
    staleTime: 0,
    retry: false, // The next poll is the retry
  })
}
