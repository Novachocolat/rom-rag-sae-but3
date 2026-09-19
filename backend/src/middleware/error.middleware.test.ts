import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { errorMiddleware } from './error.middleware.js'
import { AppError } from '../lib/error.js'
import { logger } from '../lib/logger.js'

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

  it('must handle Prisma-known error P2002 as an 409 CONFLICT', () => {
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

  it('must handle Prisma-known error P2025 as an 404 NOT_FOUND', () => {
    const prismaError = {
      code: 'P2025',
      message:
        'An operation failed because it depends on one or more records that were required but not found.',
    }

    errorMiddleware(
      prismaError,
      mockReq as Request,
      mockRes as Response,
      mockNext,
    )

    expect(mockRes.status).toHaveBeenCalledWith(404)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'NOT_FOUND',
          message: 'La ressource demandée est introuvable',
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

  it('must forward the full metadata (requestId, stack, path, method) to logger.error for 500 errors', () => {
    const nativeError = new Error('Panne de base de données fatale')

    errorMiddleware(
      nativeError,
      mockReq as Request,
      mockRes as Response,
      mockNext,
    )

    expect(logger.error).toHaveBeenCalledWith(
      'Panne de base de données fatale',
      expect.objectContaining({
        requestId: 'req-test-123',
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        path: '/api/test',
        method: 'GET',
        stack: nativeError.stack,
      }),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('must forward the full metadata (requestId, path, method) to logger.warn for non-500 errors', () => {
    const appError = new AppError(
      404,
      'ITEM_NOT_FOUND',
      'Ressource introuvable',
    )

    errorMiddleware(appError, mockReq as Request, mockRes as Response, mockNext)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Ressource introuvable'),
      expect.objectContaining({
        requestId: 'req-test-123',
        statusCode: 404,
        code: 'ITEM_NOT_FOUND',
        path: '/api/test',
        method: 'GET',
      }),
    )
    expect(logger.error).not.toHaveBeenCalled()
  })
})
