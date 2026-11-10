import { useQuery } from '@tanstack/react-query'
import { metricsSchema } from '@repo/shared/schemas'
import type { Metrics } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'

export const METRICS_QUERY_KEY = ['metrics'] as const

const METRICS_POLL_INTERVAL_MS = 15_000

// Hook to call GET /metrics and keep the report fresh by polling
export function useMetrics() {
  return useQuery<Metrics>({
    queryKey: METRICS_QUERY_KEY,
    queryFn: async () =>
      metricsSchema.parse(await apiClient<unknown>('/metrics')),
    refetchInterval: METRICS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}
