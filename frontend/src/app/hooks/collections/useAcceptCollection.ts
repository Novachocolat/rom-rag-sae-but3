import { useMutation, useQueryClient } from '@tanstack/react-query'
import { collectionDetailSchema } from '@repo/shared/schemas'
import { apiClient } from '@/lib/api-client.ts'

interface AcceptCollectionInput {
  collectionId: string
  excludeRomIds: string[]
}

// Hook to call POST /collections/<collectionId>/accept to keep an AI collection, without the excluded members
export function useAcceptCollection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      collectionId,
      excludeRomIds,
    }: AcceptCollectionInput) => {
      const response = await apiClient<unknown>(
        `/collections/${collectionId}/accept`,
        { method: 'POST', body: JSON.stringify({ excludeRomIds }) },
      )
      return collectionDetailSchema.parse(response)
    },
    onSuccess: () => {
      // The grouped library, the queue and every opened detail are stale
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}
