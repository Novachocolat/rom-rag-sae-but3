import { useQuery } from '@tanstack/react-query'
import { romDetailSchema } from '@repo/shared/schemas'
import type { RomDetail } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'
import { ApiError } from '@/lib/api-error.ts'

// Hook to call GET /roms/<id> to retrieve the full record of a ROM
export function useRom(id: string | undefined) {
  return useQuery<RomDetail>({
    queryKey: ['roms', 'detail', id],
    queryFn: async () => {
      const response = await apiClient<unknown>(`/roms/${id}`)
      return romDetailSchema.parse(response)
    },
    enabled: !!id,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.statusCode < 500) &&
      failureCount < 2,
  })
}
