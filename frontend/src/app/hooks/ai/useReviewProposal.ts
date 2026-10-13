import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { ProposalReview } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'

const reviewResponseSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
})

interface ReviewProposalInput {
  proposalId: string
  review: ProposalReview
}

// Hook to call POST /ai/proposals/<proposalId>/review to accept or reject a proposal
export function useReviewProposal() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ proposalId, review }: ReviewProposalInput) => {
      const response = await apiClient<unknown>(
        `/ai/proposals/${proposalId}/review`,
        { method: 'POST', body: JSON.stringify(review) },
      )
      return reviewResponseSchema.parse(response)
    },
    onSuccess: () => {
      // An accept rewrites the ROM: the library and the detail page are stale too
      queryClient.invalidateQueries({ queryKey: ['ai', 'proposals'] })
      queryClient.invalidateQueries({ queryKey: ['roms'] })
    },
  })
}
