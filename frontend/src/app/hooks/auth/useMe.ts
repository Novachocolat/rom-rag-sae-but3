import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import { ApiError } from '@/lib/api-error.ts'
import { publicUserSchema } from '@repo/shared/schemas'
import type { PublicUser } from '@repo/shared/types'

// Hook to call GET /auth/me to retrieve user data
export function useMe() {
  return useQuery<PublicUser | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        const response = await apiClient<unknown>('/auth/me')
        return publicUserSchema.parse(response)
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 401) {
          return null
        }

        throw error
      }
    },
    staleTime: 1000 * 60 * 15, // 15 minutes before cached data is considered stale
  })
}
