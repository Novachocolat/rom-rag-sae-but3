import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call GET /platforms to retrieve every platforms
export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => apiClient<{ id: string; name: string }[]>('/platforms'),
    staleTime: 1000 * 60 * 30,
  })
}
