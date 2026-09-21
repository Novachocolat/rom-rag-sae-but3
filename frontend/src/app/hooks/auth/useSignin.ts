import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /auth/signin to sign in to an account
export function useSignin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentials: Record<string, unknown>) => {
      return apiClient('/auth/signin', {
        method: 'POST',
        body: JSON.stringify(credentials),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
