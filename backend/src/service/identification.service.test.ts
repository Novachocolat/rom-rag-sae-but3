import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { redis } from '../lib/redis.js'
import {
  identifyRom,
  initProgress,
  updateProgress,
  getProgress,
  finishProgress,
  type DatEntry,
  type DatLookup,
  type RomCandidate,
} from './identification.service.js'

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
  it('retourne DAT_SHA1 en priorité même si les autres échelons matcheraient', async () => {
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

  it('retombe sur DAT_MD5 si SHA-1 fichier entier ne matche pas', async () => {
    const entry = makeEntry('Match MD5')
    const lookup = makeLookup({
      findByMd5Full: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(makeCandidate(), lookup)

    expect(result.source).toBe('DAT_MD5')
    expect(result.confidence).toBe(0.99)
  })

  it("n'appelle pas les échelons données-seules si headerBytesSkipped === 0 (GB/GBC/GBA)", async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ headerBytesSkipped: 0 }), lookup)

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })

  it('évalue SHA-1 données seules quand headerBytesSkipped > 0', async () => {
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

  it('retombe sur MD5 données seules si SHA-1 données seules ne matche pas', async () => {
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

  it('retombe sur DAT_NAME en dernier recours avant échec', async () => {
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
  })

  it('ne tente pas la recherche par nom si normalizedName est absent', async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ normalizedName: null }), lookup)

    expect(lookup.findByNormalizedName).not.toHaveBeenCalled()
  })

  it('retourne UNIDENTIFIED si aucun échelon ne matche', async () => {
    const lookup = makeLookup()

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('UNIDENTIFIED')
    expect(result.confidence).toBe(0)
    expect(result.entry).toBeNull()
  })

  it("n'appelle pas les échelons données-seules si les empreintes _Data sont absentes", async () => {
    const lookup = makeLookup()

    await identifyRom(
      makeCandidate({ headerBytesSkipped: 512, sha1Data: null, md5Data: null }),
      lookup,
    )

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })
})

// --- Redis-backed scan progress state --------------------------------------
// Integration tests: run against the real Redis configured in
// vitest.config.ts (REDIS_URL). Requires `docker compose up -d redis`.

describe('scan progress (Redis)', () => {
  const jobId = `test-job-${randomUUID()}`

  beforeAll(async () => {
    if (redis.status === 'wait') await redis.connect()
  })

  afterEach(async () => {
    await redis.del(`scan:${jobId}`)
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('initProgress writes the initial state with an EX ttl', async () => {
    const progress = await initProgress(redis, jobId, 10)

    expect(progress.jobId).toBe(jobId)
    expect(progress.status).toBe('RUNNING')
    expect(progress.totalFiles).toBe(10)
    expect(progress.processedFiles).toBe(0)

    const ttl = await redis.ttl(`scan:${jobId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(6 * 60 * 60)
  })

  it('getProgress returns null for an unknown jobId', async () => {
    const progress = await getProgress(redis, `unknown-${randomUUID()}`)
    expect(progress).toBeNull()
  })

  it('getProgress returns what initProgress wrote', async () => {
    await initProgress(redis, jobId, 5)
    const progress = await getProgress(redis, jobId)

    expect(progress?.totalFiles).toBe(5)
    expect(progress?.status).toBe('RUNNING')
  })

  it('updateProgress with force:true writes immediately', async () => {
    await initProgress(redis, jobId, 5)
    await updateProgress(
      redis,
      jobId,
      { processedFiles: 3, current: 'game.nes' },
      { force: true },
    )

    const progress = await getProgress(redis, jobId)
    expect(progress?.processedFiles).toBe(3)
    expect(progress?.current).toBe('game.nes')
  })

  it('updateProgress is throttled: a burst of calls does not write every time', async () => {
    await initProgress(redis, jobId, 100)

    // Fire many updates back to back without `force`; the throttle should
    // collapse most of them into a single write (by count, since elapsed
    // time is ~0ms in a tight loop).
    for (let i = 1; i <= 5; i++) {
      await updateProgress(redis, jobId, { processedFiles: i })
    }

    const progress = await getProgress(redis, jobId)
    // None of the 5 calls should have reached the "every 25 files or 500ms"
    // threshold, so the state should still show 0 processed files.
    expect(progress?.processedFiles).toBe(0)
  })

  it('finishProgress sets the final status and clears `current`', async () => {
    await initProgress(redis, jobId, 5)
    await updateProgress(
      redis,
      jobId,
      { processedFiles: 5, current: 'last.nes' },
      { force: true },
    )

    const finished = await finishProgress(redis, jobId, 'DONE')

    expect(finished?.status).toBe('DONE')
    expect(finished?.current).toBeNull()
    expect(finished?.finishedAt).toBeTruthy()
  })

  it('finishProgress returns null for an unknown jobId', async () => {
    const result = await finishProgress(
      redis,
      `unknown-${randomUUID()}`,
      'DONE',
    )
    expect(result).toBeNull()
  })
})
