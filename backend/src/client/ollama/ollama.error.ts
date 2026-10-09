import { AppError } from '../../lib/error.js'

/**
 * One class per Ollama failure mode, each pinned to the HTTP status the
 * route layer should expose. Classification happens in ollama-http.ts;
 * this file only defines the taxonomy.
 */

// ECONNREFUSED, DNS failure, or the server answering 502/503: Ollama itself
// (not a specific model) is unreachable.
export class OllamaUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'OLLAMA_UNAVAILABLE', message, details)
    this.name = 'OllamaUnavailableError'
  }
}

// AbortSignal.timeout fired before Ollama answered
export class OllamaTimeoutError extends AppError {
  constructor(message: string, details?: unknown) {
    super(504, 'OLLAMA_TIMEOUT', message, details)
    this.name = 'OllamaTimeoutError'
  }
}

// 404 with a "model not found" body: the model isn't pulled on this instance
export class OllamaModelNotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'OLLAMA_MODEL_NOT_FOUND', message, details)
    this.name = 'OllamaModelNotFoundError'
  }
}

// Response body mentions "context length" / "out of memory": prompt + history too big
export class OllamaContextOverflowError extends AppError {
  constructor(message: string, details?: unknown) {
    super(413, 'OLLAMA_CONTEXT_OVERFLOW', message, details)
    this.name = 'OllamaContextOverflowError'
  }
}

// The response body isn't parsable JSON, or fails Zod validation against the
// requested schema
export class OllamaInvalidJsonError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'OLLAMA_INVALID_JSON', message, details)
    this.name = 'OllamaInvalidJsonError'
  }
}

// Any other 5xx response
export class OllamaServerError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'OLLAMA_SERVER_ERROR', message, details)
    this.name = 'OllamaServerError'
  }
}

export type OllamaError =
  | OllamaUnavailableError
  | OllamaTimeoutError
  | OllamaModelNotFoundError
  | OllamaContextOverflowError
  | OllamaInvalidJsonError
  | OllamaServerError

// Retrying a request that failed for one of these reasons can succeed on a
// transient blip. Never retry a timeout (the inference already ran once and
// doubling a 90s wait helps no one) or an invalid JSON response (retrying
// won't make the model emit a different format).
export function isRetryableOllamaError(err: unknown): boolean {
  return (
    err instanceof OllamaServerError || err instanceof OllamaUnavailableError
  )
}
