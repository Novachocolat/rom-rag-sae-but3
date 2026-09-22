import { useMutation } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /auth/signup to sign up a new account
export function useSignup() {
  return useMutation({
    mutationFn: async (userData: Record<string, unknown>) => {
      return apiClient('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(userData),
      })
    },
  })
}
