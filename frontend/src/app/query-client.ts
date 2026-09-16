import { QueryClient } from '@tanstack/react-query'

// Initializes the cache client instance for requests
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes before cached data is considered staled*
      refetchOnWindowFocus: false, // Avoids requests on focus
      retry: 2, // Retries two times when an HTTP request fails
    },
    mutations: {
      retry: false,
    },
  },
})
