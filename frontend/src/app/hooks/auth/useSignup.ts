import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import type { SignupInput } from '@repo/shared/schemas'

// Hook to call POST /auth/signup to sign up a new account
export function useSignup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userData: SignupInput) => {
      return apiClient('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(userData),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
