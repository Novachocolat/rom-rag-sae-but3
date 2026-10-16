import { useQuery } from '@tanstack/react-query'
import { collectionProposalListSchema } from '@repo/shared/schemas'
import { apiClient } from '@/lib/api-client.ts'

export const REVIEW_PAGE_SIZE = 50

// Hook to call GET /collections/proposals to retrieve the AI groupings waiting for review
export function useCollectionProposals() {
  return useQuery({
    queryKey: ['collections', 'proposals'],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(REVIEW_PAGE_SIZE),
      })
      const response = await apiClient<unknown>(
        `/collections/proposals?${params}`,
      )
      return collectionProposalListSchema.parse(response)
    },
  })
}
