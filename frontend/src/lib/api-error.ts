import type { ApiError as ApiErrorPayload } from '@repo/shared/types'

// Frontend error type, derived from the `apiErrorSchema` envelope
export class ApiError extends Error {
  statusCode: number
  code: string
  details?: unknown
  requestId: string

  constructor(statusCode: number, error: ApiErrorPayload['error']) {
    super(error.message)
    this.statusCode = statusCode
    this.code = error.code
    this.details = error.details
    this.requestId = error.requestId

    this.name = 'ApiError'
  }
}
