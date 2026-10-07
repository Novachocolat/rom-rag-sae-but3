import { describe, expect, it } from 'vitest'
import { AppError } from '../../lib/error.js'
import {
  isRetryableOllamaError,
  OllamaContextOverflowError,
  OllamaInvalidJsonError,
  OllamaModelNotFoundError,
  OllamaServerError,
  OllamaTimeoutError,
  OllamaUnavailableError,
} from './ollama.error.js'

// Tests for the Ollama error taxonomy: one class per failure mode, each
// pinned to a fixed HTTP status and error code
describe('Ollama error taxonomy', () => {
  it.each([
    [OllamaUnavailableError, 503, 'OLLAMA_UNAVAILABLE'],
    [OllamaTimeoutError, 504, 'OLLAMA_TIMEOUT'],
    [OllamaModelNotFoundError, 503, 'OLLAMA_MODEL_NOT_FOUND'],
    [OllamaContextOverflowError, 413, 'OLLAMA_CONTEXT_OVERFLOW'],
    [OllamaInvalidJsonError, 502, 'OLLAMA_INVALID_JSON'],
    [OllamaServerError, 502, 'OLLAMA_SERVER_ERROR'],
  ] as const)(
    '%s exposes statusCode %i and code %s',
    (ErrorClass, statusCode, code) => {
      const details = { foo: 'bar' }
      const error = new ErrorClass('boom', details)

      expect(error).toBeInstanceOf(AppError)
      expect(error).toBeInstanceOf(Error)
      expect(error.statusCode).toBe(statusCode)
      expect(error.code).toBe(code)
      expect(error.message).toBe('boom')
      expect(error.details).toEqual(details)
      expect(error.name).toBe(ErrorClass.name)
    },
  )

  describe('isRetryableOllamaError', () => {
    it('is true for OllamaServerError and OllamaUnavailableError', () => {
      expect(isRetryableOllamaError(new OllamaServerError('x'))).toBe(true)
      expect(isRetryableOllamaError(new OllamaUnavailableError('x'))).toBe(true)
    })

    it('is false for a timeout, so a 90s inference is never replayed', () => {
      expect(isRetryableOllamaError(new OllamaTimeoutError('x'))).toBe(false)
    })

    it('is false for an invalid JSON response, since retrying cannot fix it', () => {
      expect(isRetryableOllamaError(new OllamaInvalidJsonError('x'))).toBe(
        false,
      )
    })

    it('is false for a missing model', () => {
      expect(isRetryableOllamaError(new OllamaModelNotFoundError('x'))).toBe(
        false,
      )
    })

    it('is false for an unrelated error', () => {
      expect(isRetryableOllamaError(new Error('unrelated'))).toBe(false)
    })
  })
})
