import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { errorMiddleware } from './error.middleware.js'
import { AppError } from '../lib/error.js'

vi.mock('../lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

// Tests for the error middleware, which handles any error
describe('errorMiddleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    vi.clearAllMocks()
    mockReq = { originalUrl: '/api/test', method: 'GET' }
    mockRes = {
      locals: { requestId: 'req-test-123' },
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    mockNext = vi.fn()
  })

  it('must handle and throw an error of AppError type', () => {
    const appError = new AppError(
      404,
      'ITEM_NOT_FOUND',
      'Ressource introuvable',
    )

    errorMiddleware(appError, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(404)
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'ITEM_NOT_FOUND',
        message: 'Ressource introuvable',
        details: undefined,
        requestId: 'req-test-123',
      },
    })
  })

  it('must intercept and format an ZodError as a 400 VALIDATION_ERROR', () => {
    const zodError = new z.ZodError([
      { code: 'custom', path: ['email'], message: 'Email requis' },
    ])

    errorMiddleware(zodError, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: zodError.issues,
        }),
      }),
    )
  })

  it('must handle Prisma-known error codes', () => {
    const prismaError = {
      code: 'P2002',
      meta: { target: ['email'] },
      message: 'Unique constraint failed',
    }

    errorMiddleware(
      prismaError,
      mockReq as Request,
      mockRes as Response,
      mockNext,
    )

    expect(mockRes.status).toHaveBeenCalledWith(409)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'CONFLICT',
          message: 'Une ressource identique existe déjà',
        }),
      }),
    )
  })

  it('must mask any unknown exception behind an 500 error without leaking stack trace', () => {
    const nativeError = new Error('Panne de base de données fatale')

    errorMiddleware(
      nativeError,
      mockReq as Request,
      mockRes as Response,
      mockNext,
    )

    expect(mockRes.status).toHaveBeenCalledWith(500)
    expect(mockRes.json).not.toHaveBeenCalledWith(
      expect.stringContaining('stack'),
    )
  })
})
