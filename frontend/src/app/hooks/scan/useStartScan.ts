import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import type { ScanRequest } from '@repo/shared/types'

// Hook to call POST /scan to start a scan
export function useStartScan() {
  return useMutation({
    mutationFn: async (payload: ScanRequest) => {
      return apiClient<{ jobId: string }>('/scans', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
  })
}
