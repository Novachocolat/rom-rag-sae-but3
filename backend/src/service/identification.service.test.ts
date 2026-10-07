import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redis } from '../lib/redis.js'
import {
  finishProgress,
  getProgress,
  identifyRom,
  initProgress,
  updateProgress,
  type DatEntry,
  type DatLookup,
  type RomCandidate,
  type ScanCounters,
} from './identification.service.js'

// Mocks Redis' get and set methods
vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
  },
}))

const set = vi.mocked(redis.set)
const get = vi.mocked(redis.get)

function makeCandidate(overrides: Partial<RomCandidate> = {}): RomCandidate {
  return {
    fileName: 'Super Mario Kart (Europe).sfc',
    sha1FullFile: 'sha1-full',
    md5FullFile: 'md5-full',
    sha1Data: 'sha1-data',
    md5Data: 'md5-data',
    headerBytesSkipped: 0,
    normalizedName: 'super mario kart',
    ...overrides,
  }
}
function makeEntry(name: string): DatEntry {
  return { name, sha1: 'x', md5: 'y' }
}
// Helper to create a mock DatLookup with optional overrides
function makeLookup(overrides: Partial<DatLookup> = {}): DatLookup {
  return {
    findBySha1Full: vi.fn().mockResolvedValue(null),
    findByMd5Full: vi.fn().mockResolvedValue(null),
    findBySha1Data: vi.fn().mockResolvedValue(null),
    findByMd5Data: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}
// Tests for identifyRom function
describe('identifyRom', () => {
  it('returns DAT_SHA1 first, even when lower tiers would also match', async () => {
    const entry = makeEntry('Match SHA1')
    const lookup = makeLookup({
      findBySha1Full: vi.fn().mockResolvedValue(entry),
      findByMd5Full: vi.fn().mockResolvedValue(makeEntry('Match MD5')),
    })

    const result = await identifyRom(makeCandidate(), lookup)

    expect(result.source).toBe('DAT_SHA1')
    expect(result.confidence).toBe(1.0)
    expect(result.entry).toBe(entry)
    expect(lookup.findByMd5Full).not.toHaveBeenCalled()
  })

  it('falls back to DAT_MD5 when the full-file SHA-1 does not match', async () => {
    const entry = makeEntry('Match MD5')
    const lookup = makeLookup({
      findByMd5Full: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(makeCandidate(), lookup)

    expect(result.source).toBe('DAT_MD5')
    expect(result.confidence).toBe(0.99)
  })

  it('skips the data-only tiers when headerBytesSkipped === 0 (GB/GBC/GBA)', async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ headerBytesSkipped: 0 }), lookup)

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })

  it('checks the data-only SHA-1 when headerBytesSkipped > 0', async () => {
    const entry = makeEntry('Match SHA1 data')
    const lookup = makeLookup({
      findBySha1Data: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_SHA1_DATA')
    expect(result.confidence).toBe(0.97)
  })

  it('falls back to the data-only MD5 when the data-only SHA-1 does not match', async () => {
    const entry = makeEntry('Match MD5 data')
    const lookup = makeLookup({
      findByMd5Data: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_MD5_DATA')
    expect(result.confidence).toBe(0.96)
  })

  it('falls back to DAT_NAME as a last resort', async () => {
    const entry = makeEntry('Match name')
    const lookup = makeLookup({
      findByNormalizedName: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_NAME')
    expect(result.confidence).toBe(0.8)
    expect(lookup.findByNormalizedName).toHaveBeenCalledWith(
      'super mario kart',
      '.sfc',
    )
  })

  it('skips the name lookup when normalizedName is missing', async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ normalizedName: null }), lookup)

    expect(lookup.findByNormalizedName).not.toHaveBeenCalled()
  })

  it('returns UNIDENTIFIED when no tier matches', async () => {
    const lookup = makeLookup()

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('UNIDENTIFIED')
    expect(result.confidence).toBe(0)
    expect(result.entry).toBeNull()
  })

  it('skips the data-only tiers when the _Data hashes are missing', async () => {
    const lookup = makeLookup()

    await identifyRom(
      makeCandidate({ headerBytesSkipped: 512, sha1Data: null, md5Data: null }),
      lookup,
    )

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })
})

function makeCounters(overrides: Partial<ScanCounters> = {}): ScanCounters {
  return {
    processedFiles: 0,
    identifiedCount: 0,
    unidentifiedCount: 0,
    errorCount: 0,
    current: null,
    ...overrides,
  }
}

// Last value written by `redis.set`, as the progress object it serializes
function lastWrittenProgress(): unknown {
  const value = set.mock.lastCall?.[1]
  return typeof value === 'string' ? JSON.parse(value) : undefined
}

// Tests for the scan progress kept in Redis (mocked): the throttle must keep
// writes rare, and the final state must always reach Redis.
describe('scan progress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    set.mockResolvedValue('OK')
  })

  afterEach(async () => {
    await finishProgress('job-1', 'COMPLETED')
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('initProgress writes a RUNNING state under scan:<jobId> with a TTL', async () => {
    await initProgress('job-1', 'user-1', 10)

    expect(set).toHaveBeenCalledWith(
      'scan:job-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    )
    expect(lastWrittenProgress()).toMatchObject({
      jobId: 'job-1',
      userId: 'user-1',
      status: 'RUNNING',
      totalFiles: 10,
      processedFiles: 0,
    })
  })

  it('updateProgress does not write on every call', async () => {
    await initProgress('job-1', 'user-1', 100)
    set.mockClear()

    for (let i = 1; i <= 5; i++) {
      await updateProgress('job-1', makeCounters({ processedFiles: i }))
    }

    expect(set).not.toHaveBeenCalled()
  })

  it('updateProgress writes once every 25 files', async () => {
    await initProgress('job-1', 'user-1', 100)
    set.mockClear()

    for (let i = 1; i <= 25; i++) {
      await updateProgress('job-1', makeCounters({ processedFiles: i }))
    }

    expect(set).toHaveBeenCalledTimes(1)
    expect(lastWrittenProgress()).toMatchObject({ processedFiles: 25 })
  })

  it('updateProgress writes once 500 ms have passed since the last write', async () => {
    await initProgress('job-1', 'user-1', 100)
    set.mockClear()

    vi.advanceTimersByTime(500)
    await updateProgress(
      'job-1',
      makeCounters({ processedFiles: 1, current: 'nes/game.nes' }),
    )

    expect(set).toHaveBeenCalledTimes(1)
    expect(lastWrittenProgress()).toMatchObject({
      processedFiles: 1,
      current: 'nes/game.nes',
    })
  })

  it('updateProgress ignores a job that was never initialized', async () => {
    vi.advanceTimersByTime(500)
    await updateProgress('unknown-job', makeCounters())

    expect(set).not.toHaveBeenCalled()
  })

  it('finishProgress writes the final status with the latest counters, even throttled ones', async () => {
    await initProgress('job-1', 'user-1', 5)
    await updateProgress(
      'job-1',
      makeCounters({ processedFiles: 2, current: 'b.nes' }),
    )

    await finishProgress('job-1', 'FAILED', 'disk unreadable')

    expect(lastWrittenProgress()).toMatchObject({
      status: 'FAILED',
      processedFiles: 2,
      current: null,
      errorMessage: 'disk unreadable',
    })
  })

  it('finishProgress does nothing for a job that was never initialized', async () => {
    await finishProgress('unknown-job', 'COMPLETED')

    expect(set).not.toHaveBeenCalled()
  })

  it('getProgress reads the progress back from Redis', async () => {
    get.mockResolvedValue(null)

    await expect(getProgress('job-1')).resolves.toBeNull()
    expect(get).toHaveBeenCalledWith('scan:job-1')
  })
})
