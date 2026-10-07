import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../env.js'
import { redis } from '../lib/redis.js'
import {
  buildAiCacheKey,
  getCachedIdentification,
  setCachedIdentification,
  type CachedIdentification,
} from './ai-cache.storage.js'

vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn() },
}))

const base = {
  kind: 'identification',
  model: 'gemma4:26b',
  promptName: 'identification',
  promptVersion: 'v1',
  renderedPrompt: 'Identify Tetris',
}

const entry: CachedIdentification = {
  data: {
    title: 'Tetris',
    platform: null,
    region: null,
    languages: [],
    releaseYear: null,
    publisher: null,
    genre: null,
    confidence: 0.9,
    reasoning: 'ok',
  },
  raw: '{}',
  model: 'gemma4:26b',
  durationMs: 10,
  promptTokens: 1,
  completionTokens: 1,
  tokensPerSecond: 1,
}

// Tests for the AI cache: key derivation and Redis access with TTL
describe('buildAiCacheKey', () => {
  it('follows the ai:<kind>:<sha256> format', () => {
    expect(buildAiCacheKey(base)).toMatch(/^ai:identification:[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', () => {
    expect(buildAiCacheKey(base)).toBe(buildAiCacheKey({ ...base }))
  })

  it.each([
    ['model', { model: 'other-model' }],
    ['prompt name', { promptName: 'other' }],
    ['prompt version', { promptVersion: 'v2' }],
    ['rendered prompt', { renderedPrompt: 'Identify Sonic' }],
  ])('changes when the %s changes', (_label, change) => {
    expect(buildAiCacheKey({ ...base, ...change })).not.toBe(
      buildAiCacheKey(base),
    )
  })

  it('does not collide when field boundaries shift', () => {
    const a = buildAiCacheKey({ ...base, model: 'ab', promptName: 'c' })
    const b = buildAiCacheKey({ ...base, model: 'a', promptName: 'bc' })

    expect(a).not.toBe(b)
  })
})

describe('getCachedIdentification', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns null on a miss', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)

    expect(await getCachedIdentification('ai:identification:x')).toBeNull()
  })

  it('returns the stored entry on a hit', async () => {
    vi.mocked(redis.get).mockResolvedValue(JSON.stringify(entry))

    expect(await getCachedIdentification('ai:identification:x')).toEqual(entry)
  })

  it('treats a corrupt or outdated entry as a miss', async () => {
    vi.mocked(redis.get).mockResolvedValue('{not json')
    expect(await getCachedIdentification('k')).toBeNull()

    vi.mocked(redis.get).mockResolvedValue(
      JSON.stringify({ data: 'old shape' }),
    )
    expect(await getCachedIdentification('k')).toBeNull()
  })
})

describe('setCachedIdentification', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('stores the entry with the configured TTL', async () => {
    await setCachedIdentification('ai:identification:x', entry)

    expect(redis.set).toHaveBeenCalledWith(
      'ai:identification:x',
      JSON.stringify(entry),
      'EX',
      env.AI_CACHE_TTL_SECONDS,
    )
  })
})
