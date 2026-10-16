import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /collections/detect to start the detection job
export function useDetectCollections() {
  return useMutation({
    mutationFn: () =>
      apiClient<{ jobId: string }>('/collections/detect', { method: 'POST' }),
  })
}
