import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import type { LoginInput } from '@repo/shared/schemas'

// Hook to call POST /auth/login to sign in to an account
export function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentials: LoginInput) => {
      return apiClient('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
