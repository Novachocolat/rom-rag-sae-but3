import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { notFoundMiddleware } from './not-found.middleware.js'
import { AppError } from '../lib/error.js'

// Tests for the notFound middleware, which throws an 400 Not Found error on any unknown route
describe('notFoundMiddleware', () => {
  it('must throw an 404 Not Found error', () => {
    const mockReq = { method: 'POST', originalUrl: '/api/unknown' } as Request
    const mockRes = {} as Response
    const mockNext = vi.fn()

    notFoundMiddleware(mockReq, mockRes, mockNext)

    expect(mockNext).toHaveBeenCalledTimes(1)
    const argument = mockNext.mock.calls[0]![0]

    expect(argument).toBeInstanceOf(AppError)
    expect(argument.statusCode).toBe(404)
    expect(argument.code).toBe('ROUTE_NOT_FOUND')
  })
})
