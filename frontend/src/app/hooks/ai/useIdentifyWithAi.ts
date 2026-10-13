import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { aiProposalSchema } from '@repo/shared/schemas'
import { apiClient } from '@/lib/api-client.ts'
import { HEALTH_QUERY_KEY } from '@/app/hooks/health/useHealth.ts'

const identifyResponseSchema = z.object({ proposal: aiProposalSchema })

// Hook to call POST /ai/roms/<romId>/identify to ask the model for a proposal
export function useIdentifyWithAi() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (romId: string) => {
      const response = await apiClient<unknown>(`/ai/roms/${romId}/identify`, {
        method: 'POST',
      })
      return identifyResponseSchema.parse(response).proposal
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'proposals'] })
    },
    onError: () => {
      // Ollama may have gone down since the last poll: refresh the status now
      queryClient.invalidateQueries({ queryKey: HEALTH_QUERY_KEY })
    },
  })
}
