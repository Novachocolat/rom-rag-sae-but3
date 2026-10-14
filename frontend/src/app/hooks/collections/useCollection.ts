import { useQuery } from '@tanstack/react-query'
import { collectionDetailSchema } from '@repo/shared/schemas'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call GET /collections/<id> to retrieve the variants of a collection
export function useCollection(id: string) {
  return useQuery({
    queryKey: ['collections', 'detail', id],
    queryFn: async () => {
      const response = await apiClient<unknown>(`/collections/${id}`)
      return collectionDetailSchema.parse(response)
    },
  })
}
