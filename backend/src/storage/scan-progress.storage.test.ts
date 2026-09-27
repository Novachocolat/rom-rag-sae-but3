import { describe, expect, it, vi } from 'vitest'
import { redis } from '../lib/redis.js'
import {
  getScanProgress,
  saveScanProgress,
  type StoredScanProgress,
} from './scan-progress.storage.js'

// Mocks Redis' get and set methods
vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
  },
}))

const set = vi.mocked(redis.set)
const get = vi.mocked(redis.get)

// Fixture of a stored scan progress
const progress: StoredScanProgress = {
  jobId: 'job-1',
  userId: 'user-1',
  status: 'RUNNING',
  totalFiles: 10,
  processedFiles: 4,
  identifiedCount: 3,
  unidentifiedCount: 1,
  errorCount: 0,
  current: 'snes/game.sfc',
  errorMessage: null,
}

// Tests for the Redis-backed scan progress: stored as JSON under
// `scan:<jobId>`, with Redis owning the expiry.
describe('scan-progress.storage', () => {
  it('saveScanProgress stores the JSON under scan:<jobId> with a TTL', async () => {
    set.mockResolvedValue('OK')

    await saveScanProgress(progress)

    expect(set).toHaveBeenCalledWith(
      'scan:job-1',
      JSON.stringify(progress),
      'EX',
      6 * 60 * 60,
    )
  })

  it('getScanProgress parses the stored JSON back', async () => {
    get.mockResolvedValue(JSON.stringify(progress))

    await expect(getScanProgress('job-1')).resolves.toEqual(progress)
    expect(get).toHaveBeenCalledWith('scan:job-1')
  })

  it('getScanProgress returns null for an unknown or expired job', async () => {
    get.mockResolvedValue(null)

    await expect(getScanProgress('missing')).resolves.toBeNull()
  })

  it('getScanProgress rejects a value that does not match the schema', async () => {
    get.mockResolvedValue(JSON.stringify({ jobId: 'job-1' }))

    await expect(getScanProgress('job-1')).rejects.toThrow()
  })
})
