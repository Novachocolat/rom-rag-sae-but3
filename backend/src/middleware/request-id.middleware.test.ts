import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { requestIdMiddleware } from './request-id.middleware.js'

describe('requestIdMiddleware', () => {
  it('must generate an UUID, inject it into `res.locals` and in the `X-Request-Id` header', () => {
    const mockReq = {} as Request
    const mockRes = {
      locals: {},
      setHeader: vi.fn(),
    } as unknown as Response
    const mockNext = vi.fn() as NextFunction

    requestIdMiddleware(mockReq, mockRes, mockNext)

    // 1. Verifies if it is stored correctly in `res.locals` of the request
    expect(mockRes.locals.requestId).toBeDefined()
    expect(typeof mockRes.locals.requestId).toBe('string')

    // 2. Verifies the HTTP header and its UUID v4 format
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      mockRes.locals.requestId,
    )
    expect(mockRes.locals.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )

    expect(mockNext).toHaveBeenCalledTimes(1)
    expect(mockNext).toHaveBeenCalledWith()
  })
})
