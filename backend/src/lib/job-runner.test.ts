import { describe, expect, it, vi } from 'vitest'
import { startJob, cancelJob, getJobStatus } from './job-runner.js'

vi.mock('./logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('job-runner', () => {
  it('returns a job id immediately without waiting for fn to resolve', () => {
    let resolved = false
    const id = startJob(async () => {
      await new Promise((r) => setTimeout(r, 20))
      resolved = true
    })

    expect(id).toBeTruthy()
    expect(resolved).toBe(false)
    expect(getJobStatus(id)).toBe('RUNNING')
  })

  it('marks the job as DONE once fn resolves', async () => {
    const id = startJob(async () => {
      await tick()
    })

    await tick()
    await tick()

    expect(getJobStatus(id)).toBe('DONE')
  })

  it('marks the job as ERROR when fn rejects', async () => {
    const id = startJob(async () => {
      await tick()
      throw new Error('boom')
    })

    await tick()
    await tick()

    expect(getJobStatus(id)).toBe('ERROR')
  })

  it('does not throw an unhandled rejection when fn rejects', async () => {
    startJob(async () => {
      throw new Error('boom')
    })

    await tick()
    expect(true).toBe(true)
  })

  it('cancelJob aborts the signal; a cooperative fn ends as CANCELLED', async () => {
    const id = startJob(async (signal) => {
      await tick()
      // A real job (e.g. runScan) checks the signal between steps and
      // stops itself; that's simulated here by throwing on abort.
      if (signal.aborted) throw new Error('aborted')
    })

    const cancelled = cancelJob(id)
    await tick()
    await tick()

    expect(cancelled).toBe(true)
    expect(getJobStatus(id)).toBe('CANCELLED')
  })

  it('cancelJob returns false for an unknown job id', () => {
    expect(cancelJob('does-not-exist')).toBe(false)
  })

  it('cancelJob returns false for a job that already finished', async () => {
    const id = startJob(async () => {
      await tick()
    })

    await tick()
    await tick()
    expect(getJobStatus(id)).toBe('DONE')

    expect(cancelJob(id)).toBe(false)
  })

  it('getJobStatus returns null for an unknown job id', () => {
    expect(getJobStatus('does-not-exist')).toBeNull()
  })
})
