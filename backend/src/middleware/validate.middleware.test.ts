import { describe, it, expect, vi } from 'vitest'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { validate } from './validate.middleware.js'

// Tests for request validation middleware, which validate requests before going through
describe('validateMiddleware', () => {
  it('must allow through the request if no schema was configured', async () => {
    const middleware = validate({})
    const req = { body: {}, query: {}, params: {} } as Request
    const next = vi.fn()

    await middleware(req, {} as Response, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('must transfer an exception to next if the validation of the body fails', async () => {
    const schema = { body: z.object({ age: z.number().min(18) }) }
    const middleware = validate(schema)
    const req = { body: { age: 16 }, query: {}, params: {} } as Request
    const next = vi.fn()

    await middleware(req, {} as Response, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0]![0]).toBeInstanceOf(z.ZodError)
  })
})
