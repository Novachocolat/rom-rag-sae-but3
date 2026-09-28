import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from './logger.js'

describe('Logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('must write info-level logs to stdout in JSON format', () => {
    logger.info('Standard write test', { requestId: 'req-123' })

    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    expect(stderrSpy).not.toHaveBeenCalled()

    const rawOutput = stdoutSpy.mock.calls[0]![0] as string
    const jsonPayload = JSON.parse(rawOutput.trim())

    expect(jsonPayload.level).toBe('info')
    expect(jsonPayload.msg).toBe('Standard write test')
    expect(jsonPayload.requestId).toBe('req-123')
    expect(jsonPayload.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    )
  })

  it('must exclusively redirect error-level logs to stderr', () => {
    logger.error('Critical failure detected', { code: 'CRITICAL_FAIL' })

    expect(stderrSpy).toHaveBeenCalledTimes(1)
    expect(stdoutSpy).not.toHaveBeenCalled()

    const rawOutput = stderrSpy.mock.calls[0]![0] as string
    const jsonPayload = JSON.parse(rawOutput.trim())

    expect(jsonPayload.level).toBe('error')
    expect(jsonPayload.msg).toBe('Critical failure detected')
    expect(jsonPayload.code).toBe('CRITICAL_FAIL')
  })

  it('must generate an ISO timestamp based on Europe/Paris time zone', () => {
    const fixedTime = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(fixedTime)

    logger.info('Clock check')

    const rawOutput = stdoutSpy.mock.calls[0]![0] as string
    const jsonPayload = JSON.parse(rawOutput.trim())

    expect(jsonPayload.timestamp).toBe('2026-01-01T01:00:00Z')

    vi.useRealTimers()
  })
})
