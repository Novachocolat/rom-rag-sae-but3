import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import { ApiError } from '@/lib/api-error.ts'

interface UserSession {
  id: string
  email: string
}

// Hook to call GET /auth/me to retrive user data
export function useMe() {
  return useQuery<UserSession | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await apiClient<UserSession>('/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 401) {
          return null
        }

        throw error
      }
    },
    staleTime: 1000 * 60 * 15, // 15 minutes before cached data is considered staled
  })
}
