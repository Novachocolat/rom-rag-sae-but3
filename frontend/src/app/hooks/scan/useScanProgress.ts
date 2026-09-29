import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import { scanProgressSchema } from '@repo/shared/schemas'
import type { ScanProgress } from '@repo/shared/types'

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED']

// Hook to call GET /scan/<jobId> to retrieve a scan progress
export function useScanProgress(jobId: string | undefined) {
  return useQuery<ScanProgress>({
    queryKey: ['scans', jobId],
    queryFn: async () => {
      const response = await apiClient<unknown>(`/scans/${jobId}`)
      return scanProgressSchema.parse(response)
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && TERMINAL_STATUSES.includes(status) ? false : 1500 // Quits polling if scan is `COMPLETED`, `FAILED` or `CANCELLED`
    },
  })
}
