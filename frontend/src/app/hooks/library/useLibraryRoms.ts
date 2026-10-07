import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import { useAppSelector } from '@/app/store/store-hooks'
import {
  createPaginatedResponseSchema,
  romSummarySchema,
} from '@repo/shared/schemas'

// Creates a paginated response using Zod
const romListResponseSchema = createPaginatedResponseSchema(romSummarySchema)

// Hook to call GET /roms?<params> with parameters to retrieve a paginated list of ROMs in a library
export function useLibraryRoms() {
  const filters = useAppSelector((state) => state.filters)

  return useQuery({
    queryKey: ['roms', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.platformId) params.set('platformId', filters.platformId)
      if (filters.identificationSource)
        params.set('identificationSource', filters.identificationSource)
      params.set('page', String(filters.page))
      if (filters.sort) params.set('sort', filters.sort)

      const response = await apiClient<unknown>(`/roms?${params}`)
      return romListResponseSchema.parse(response)
    },
  })
}
