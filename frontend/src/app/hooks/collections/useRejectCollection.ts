import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call DELETE /collections/<collectionId>: dissolving an AI collection is how it is rejected
export function useRejectCollection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (collectionId: string) => {
      await apiClient<unknown>(`/collections/${collectionId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
    },
  })
}
