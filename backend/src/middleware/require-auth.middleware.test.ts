import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { requireAuth } from './require-auth.middleware.js'
import { getSession, touchSession } from '../storage/session.storage.js'

vi.mock('../storage/session.storage.js', () => ({
  getSession: vi.fn(),
  touchSession: vi.fn(),
}))

const getSessionMock = vi.mocked(getSession)
const touchSessionMock = vi.mocked(touchSession)

// Tests for the middleware that resolves the session cookie into
// `res.locals.userId`, gating every route mounted behind it.
describe('requireAuth', () => {
  it('rejects with 401 when there is no session cookie', async () => {
    const req = { cookies: {} } as Request
    const res = { locals: {} } as Response
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0]![0]
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHENTICATED')
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the cookie does not match a live session', async () => {
    getSessionMock.mockResolvedValue(null)

    const req = { cookies: { rr_session: 'stale-token' } } as unknown as Request
    const res = { locals: {} } as Response
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(getSessionMock).toHaveBeenCalledWith('stale-token')
    expect(next.mock.calls[0]![0].statusCode).toBe(401)
    expect(touchSessionMock).not.toHaveBeenCalled()
  })

  it('sets res.locals.userId and renews the TTL for a valid session', async () => {
    getSessionMock.mockResolvedValue('user-1')

    const req = { cookies: { rr_session: 'valid-token' } } as unknown as Request
    const res = { locals: {} } as Response
    const next = vi.fn()

    await requireAuth(req, res, next)

    expect(res.locals.userId).toBe('user-1')
    expect(touchSessionMock).toHaveBeenCalledWith('valid-token', 604800)
    expect(next).toHaveBeenCalledWith()
  })
})
