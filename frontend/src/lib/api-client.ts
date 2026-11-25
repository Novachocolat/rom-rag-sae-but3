import { apiErrorSchema } from '@repo/shared/schemas'
import { ApiError } from './api-error.js'

// Initializes an API client to handle requests and errors
export async function apiClient<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL
  const url = `${baseUrl}${path}`

  const defaultOptions: RequestInit = {
    credentials: 'include', // Always include cookies
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }

  let response: Response
  try {
    response = await fetch(url, defaultOptions)
  } catch {
    throw new ApiError(503, {
      code: 'SERVER_UNREACHABLE',
      message: "Couldn't reach the server. Please retry after",
      requestId: 'unknown',
    })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body)

    if (parsedError.success) {
      throw new ApiError(response.status, parsedError.data.error)
    }

    // Fallback if the format can not be interpreted by the server
    throw new ApiError(response.status, {
      code: 'UNKNOWN_ERROR',
      message: 'An error occured from the server. Please retry after',
      details: body,
      requestId: 'unknown',
    })
  }

  return body as T
}
