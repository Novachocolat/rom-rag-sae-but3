import { useQuery } from '@tanstack/react-query'
import { collectionListSchema } from '@repo/shared/schemas'
import { apiClient } from '@/lib/api-client.ts'

export const COLLECTIONS_PAGE_SIZE = 20

// Hook to call GET /collections?<params> to retrieve a page of the grouped library
export function useCollections(page: number) {
  return useQuery({
    queryKey: ['collections', 'list', { page }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(COLLECTIONS_PAGE_SIZE),
      })
      const response = await apiClient<unknown>(`/collections?${params}`)
      return collectionListSchema.parse(response)
    },
  })
}
