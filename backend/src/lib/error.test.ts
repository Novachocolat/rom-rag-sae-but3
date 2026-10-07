import { describe, it, expect } from 'vitest'
import { AppError } from './error.js'

// Tests for the AppError class, which uses factories for common errors
describe('AppError', () => {
  describe('Constructor', () => {
    it('must correctly instantiate AppError with all its properties', () => {
      const detailsMock = { reason: 'invalid_format' }
      const error = new AppError(
        422,
        'VALIDATION_FAILED',
        'Invalid data',
        detailsMock,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(AppError)
      expect(error.name).toBe('AppError')
      expect(error.statusCode).toBe(422)
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.message).toBe('Invalid data')
      expect(error.details).toEqual(detailsMock)
    })

    it('must accept predefined details or optional', () => {
      const error = new AppError(500, 'INTERNAL_ERROR', 'Server error')

      expect(error.details).toBeUndefined()
    })
  })

  describe('Factories', () => {
    it('notFound() must create a 404 error', () => {
      const error = AppError.notFound(
        'RESOURCE_NOT_FOUND',
        'Resource not found',
      )

      expect(error.statusCode).toBe(404)
      expect(error.code).toBe('RESOURCE_NOT_FOUND')
      expect(error.message).toBe('Resource not found')
    })

    it('badRequest() must create a 400 error', () => {
      const error = AppError.badRequest(
        'INVALID_PAYLOAD',
        'Malformed request body',
      )

      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('INVALID_PAYLOAD')
      expect(error.message).toBe('Malformed request body')
    })

    it('unauthorized() must create a 401 error', () => {
      const error = AppError.unauthorized(
        'SESSION_EXPIRED',
        'Your session has expired',
      )

      expect(error.statusCode).toBe(401)
      expect(error.code).toBe('SESSION_EXPIRED')
      expect(error.message).toBe('Your session has expired')
    })

    it('conflict() must create a 409 error', () => {
      const error = AppError.conflict(
        'RESOURCE_ALREADY_EXISTS',
        'This resource already exists',
      )

      expect(error.statusCode).toBe(409)
      expect(error.code).toBe('RESOURCE_ALREADY_EXISTS')
      expect(error.message).toBe('This resource already exists')
    })

    it('serviceUnavailable() must create a 503 error and include optional details', () => {
      const details = { host: 'localhost:11434' }
      const error = AppError.serviceUnavailable(
        'OLLAMA_UNAVAILABLE',
        'Ollama is not responding',
        details,
      )

      expect(error.statusCode).toBe(503)
      expect(error.code).toBe('OLLAMA_UNAVAILABLE')
      expect(error.message).toBe('Ollama is not responding')
      expect(error.details).toEqual(details)
    })

    it('payloadTooLarge() must create a 413 error', () => {
      const error = AppError.payloadTooLarge(
        'OLLAMA_CONTEXT_OVERFLOW',
        'Prompt exceeds the context window',
      )

      expect(error.statusCode).toBe(413)
      expect(error.code).toBe('OLLAMA_CONTEXT_OVERFLOW')
      expect(error.message).toBe('Prompt exceeds the context window')
    })

    it('badGateway() must create a 502 error', () => {
      const error = AppError.badGateway(
        'OLLAMA_SERVER_ERROR',
        'Ollama returned a server error',
      )

      expect(error.statusCode).toBe(502)
      expect(error.code).toBe('OLLAMA_SERVER_ERROR')
      expect(error.message).toBe('Ollama returned a server error')
    })

    it('gatewayTimeout() must create a 504 error', () => {
      const error = AppError.gatewayTimeout(
        'OLLAMA_TIMEOUT',
        'Ollama did not respond in time',
      )

      expect(error.statusCode).toBe(504)
      expect(error.code).toBe('OLLAMA_TIMEOUT')
      expect(error.message).toBe('Ollama did not respond in time')
    })
  })
})
