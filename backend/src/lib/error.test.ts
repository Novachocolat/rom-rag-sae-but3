import { describe, it, expect } from 'vitest'
import { AppError } from './error.js'

// Tests for the AppError class, which uses factories for common errors
describe('AppError', () => {
  describe('Constructor', () => {
    it('must correctly instanciate AppError with all its properties', () => {
      const detailsMock = { reason: 'invalid_format' }
      const error = new AppError(
        422,
        'VALIDATION_FAILED',
        'Données invalides',
        detailsMock,
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(AppError)
      expect(error.name).toBe('AppError')
      expect(error.statusCode).toBe(422)
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.message).toBe('Données invalides')
      expect(error.details).toEqual(detailsMock)
    })

    it('must accept predefined details or optional', () => {
      const error = new AppError(500, 'INTERNAL_ERROR', 'Erreur serveur')

      expect(error.details).toBeUndefined()
    })
  })

  describe('Factories', () => {
    it('notFound() must create an 404 error', () => {
      const error = AppError.notFound(
        'RESOURCE_NOT_FOUND',
        'La ressource spécifiée est introuvable',
      )

      expect(error.statusCode).toBe(404)
      expect(error.code).toBe('RESOURCE_NOT_FOUND')
      expect(error.message).toBe('La ressource spécifiée est introuvable')
    })

    it('badRequest() must create an 400 error', () => {
      const error = AppError.badRequest(
        'INVALID_PAYLOAD',
        'Le corps de la requête est malformé',
      )

      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('INVALID_PAYLOAD')
      expect(error.message).toBe('Le corps de la requête est malformé')
    })

    it('unauthorized() must create an 401 error', () => {
      const error = AppError.unauthorized(
        'SESSION_EXPIRED',
        'Votre session a expiré',
      )

      expect(error.statusCode).toBe(401)
      expect(error.code).toBe('SESSION_EXPIRED')
      expect(error.message).toBe('Votre session a expiré')
    })

    it('conflict() must create an 409 error', () => {
      const error = AppError.conflict(
        'RESOURCE_ALREADY_EXISTS',
        'Cette ressource existe déjà',
      )

      expect(error.statusCode).toBe(409)
      expect(error.code).toBe('RESOURCE_ALREADY_EXISTS')
      expect(error.message).toBe('Cette ressource existe déjà')
    })

    it('serviceUnavailable() must create an 503 error and include optional details', () => {
      const details = { host: 'localhost:11434' }
      const error = AppError.serviceUnavailable(
        'OLLAMA_UNAVAILABLE',
        'Ollama ne répond pas',
        details,
      )

      expect(error.statusCode).toBe(503)
      expect(error.code).toBe('OLLAMA_UNAVAILABLE')
      expect(error.message).toBe('Ollama ne répond pas')
      expect(error.details).toEqual(details)
    })
  })
})
