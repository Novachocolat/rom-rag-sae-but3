import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /auth/logout to sign out of an account
export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return apiClient('/auth/logout', {
        method: 'POST',
      })
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], null)
      queryClient.invalidateQueries()
    },
  })
}
