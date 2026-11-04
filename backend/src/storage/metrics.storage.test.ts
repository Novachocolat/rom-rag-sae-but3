import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  METRICS_SAMPLE_WINDOW,
  readRawMetrics,
  recordCacheLookup,
  recordError,
  recordInference,
} from './metrics.storage.js'

const { chain, redisMock } = vi.hoisted(() => {
  const chain = {
    hincrby: vi.fn(),
    lpush: vi.fn(),
    ltrim: vi.fn(),
    exec: vi.fn(),
  }
  chain.hincrby.mockReturnValue(chain)
  chain.lpush.mockReturnValue(chain)
  chain.ltrim.mockReturnValue(chain)

  return {
    chain,
    redisMock: {
      multi: vi.fn(() => chain),
      incr: vi.fn(),
      hincrby: vi.fn(),
      hgetall: vi.fn(),
      get: vi.fn(),
      lrange: vi.fn(),
    },
  }
})

vi.mock('../lib/redis.js', () => ({ redis: redisMock }))
vi.mock('../lib/logger.js', () => ({ logger: { warn: vi.fn() } }))

const sample = { model: 'gemma', durationMs: 1500, tokensPerSecond: 20 }

// Tests for the Redis metrics store: counters, bounded sample lists, best effort
describe('metrics.storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordInference', () => {
    it('counts the inference and pushes bounded duration and speed samples', async () => {
      await recordInference(sample)

      expect(chain.hincrby).toHaveBeenCalledWith(
        'metrics:inferences',
        'gemma',
        1,
      )
      expect(chain.lpush).toHaveBeenCalledWith('metrics:durations:gemma', 1500)
      expect(chain.lpush).toHaveBeenCalledWith('metrics:tps:gemma', 20)
      expect(chain.ltrim).toHaveBeenCalledWith(
        'metrics:durations:gemma',
        0,
        METRICS_SAMPLE_WINDOW - 1,
      )
      expect(chain.ltrim).toHaveBeenCalledWith(
        'metrics:tps:gemma',
        0,
        METRICS_SAMPLE_WINDOW - 1,
      )
    })

    it('never rejects when Redis fails', async () => {
      redisMock.multi.mockImplementationOnce(() => {
        throw new Error('connection refused')
      })

      await expect(recordInference(sample)).resolves.toBeUndefined()
    })
  })

  it('counts errors by type', async () => {
    await recordError('OLLAMA_TIMEOUT')

    expect(redisMock.hincrby).toHaveBeenCalledWith(
      'metrics:errors',
      'OLLAMA_TIMEOUT',
      1,
    )
  })

  it('counts cache hits and misses on separate keys', async () => {
    await recordCacheLookup(true)
    await recordCacheLookup(false)

    expect(redisMock.incr).toHaveBeenNthCalledWith(1, 'metrics:cache:hits')
    expect(redisMock.incr).toHaveBeenNthCalledWith(2, 'metrics:cache:misses')
  })

  describe('readRawMetrics', () => {
    it('parses counters and samples into numbers', async () => {
      redisMock.hgetall.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'metrics:inferences'
            ? { gemma: '2' }
            : { OLLAMA_TIMEOUT: '1' },
        ),
      )
      redisMock.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'metrics:cache:hits' ? '5' : null),
      )
      redisMock.lrange.mockImplementation((key: string) =>
        Promise.resolve(
          key.startsWith('metrics:durations') ? ['100', '200'] : ['10'],
        ),
      )

      expect(await readRawMetrics()).toEqual({
        inferencesByModel: { gemma: 2 },
        durationsByModel: { gemma: [100, 200] },
        tokensPerSecondByModel: { gemma: [10] },
        cacheHits: 5,
        cacheMisses: 0,
        errorsByType: { OLLAMA_TIMEOUT: 1 },
      })
    })
  })
})
