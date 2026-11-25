import { useMutation, useQueryClient } from '@tanstack/react-query'
import { proposalBulkReviewResultSchema } from '@repo/shared/schemas'
import type { ProposalBulkReview } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /ai/proposals/review-batch to review every pending proposal above a confidence
export function useBulkReviewProposals() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (review: ProposalBulkReview) => {
      const response = await apiClient<unknown>('/ai/proposals/review-batch', {
        method: 'POST',
        body: JSON.stringify(review),
      })
      return proposalBulkReviewResultSchema.parse(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'proposals'] })
      queryClient.invalidateQueries({ queryKey: ['roms'] })
    },
  })
}
