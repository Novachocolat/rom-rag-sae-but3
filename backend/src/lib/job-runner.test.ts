import { describe, expect, it, vi } from 'vitest'
import { cancelJob, startJob } from './job-runner.js'
import { logger } from './logger.js'

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn() },
}))

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Tests for the in-memory job registry: jobs run in the background, their
// failures are logged instead of crashing the process, and they can be aborted.
describe('job-runner', () => {
  it('returns a job id without waiting for fn to settle', () => {
    const fn = vi.fn(() => new Promise<void>(() => {}))

    const id = startJob(fn)

    expect(id).toEqual(expect.any(String))
    expect(fn).not.toHaveBeenCalled()
  })

  it('reuses the id given by the caller', () => {
    expect(startJob(() => Promise.resolve(), 'job-42')).toBe('job-42')
  })

  it('logs a rejection instead of leaving it unhandled', async () => {
    const id = startJob(() => Promise.reject(new Error('boom')))
    await flush()

    expect(logger.error).toHaveBeenCalledWith(`Job ${id} failed`, {
      stack: expect.stringContaining('boom'),
    })
  })

  it('logs a synchronous throw as well', async () => {
    startJob(() => {
      throw new Error('sync boom')
    })
    await flush()

    expect(logger.error).toHaveBeenCalledWith(expect.any(String), {
      stack: expect.stringContaining('sync boom'),
    })
  })

  it('cancelJob aborts the signal handed to fn', async () => {
    let received: AbortSignal | undefined
    const id = startJob((signal) => {
      received = signal
      return new Promise<void>(() => {})
    })
    await flush()

    expect(cancelJob(id)).toBe(true)
    expect(received?.aborted).toBe(true)
  })

  it('cancelJob returns false for an unknown id', () => {
    expect(cancelJob('does-not-exist')).toBe(false)
  })

  it('cancelJob returns false once the job has ended', async () => {
    const id = startJob(() => Promise.resolve())
    await flush()

    expect(cancelJob(id)).toBe(false)
  })
})
