import { useQuery } from '@tanstack/react-query'
import {
  aiProposalSchema,
  createPaginatedResponseSchema,
} from '@repo/shared/schemas'
import type { AiProposalStatusFilter } from '@repo/shared/types'
import { apiClient } from '@/lib/api-client.ts'

// Creates a paginated response using Zod
const proposalListResponseSchema =
  createPaginatedResponseSchema(aiProposalSchema)

interface UseProposalsOptions {
  romId?: string
  status?: AiProposalStatusFilter
  page?: number
  pageSize?: number
}

// Hook to call GET /ai/proposals?<params>: the review queue by default, or the hole proposal history of a ROM with `romId` and the `ALL` status
export function useProposals({
  romId,
  status = 'PENDING',
  page = 1,
  pageSize = 20,
}: UseProposalsOptions = {}) {
  return useQuery({
    queryKey: ['ai', 'proposals', { romId, status, page, pageSize }],
    queryFn: async () => {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      })
      if (romId) params.set('romId', romId)

      const response = await apiClient<unknown>(`/ai/proposals?${params}`)
      return proposalListResponseSchema.parse(response)
    },
  })
}
