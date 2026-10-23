import { describe, expect, it } from 'vitest'
import type { RawMetrics } from '../storage/metrics.storage.js'
import { average, buildMetrics, percentile } from './metrics.service.js'

const config = {
  llmModel: 'gemma4:26b',
  embeddingModel: 'embed',
  embeddingDimension: 768,
  contextWindow: 8192,
  temperature: 0.2,
  thinking: false,
  confidenceThreshold: 0.7,
}

const empty: RawMetrics = {
  inferencesByModel: {},
  durationsByModel: {},
  tokensPerSecondByModel: {},
  cacheHits: 0,
  cacheMisses: 0,
  errorsByType: {},
}

describe('average', () => {
  it('returns null without samples', () => {
    expect(average([])).toBeNull()
  })

  it('returns the arithmetic mean', () => {
    expect(average([1, 2, 6])).toBe(3)
  })
})

describe('percentile', () => {
  it('returns null without samples', () => {
    expect(percentile([], 0.95)).toBeNull()
  })

  it('uses the nearest rank, whatever the input order', () => {
    const samples = Array.from({ length: 20 }, (_, i) => 20 - i) // 20..1
    expect(percentile(samples, 0.95)).toBe(19)
  })

  it('returns the only sample of a single-element list', () => {
    expect(percentile([42], 0.95)).toBe(42)
  })
})

describe('buildMetrics', () => {
  it('reports null stats and no hit rate before any activity', () => {
    const metrics = buildMetrics(empty, config, 0)

    expect(metrics.inference).toEqual({ total: 0, models: [] })
    expect(metrics.cache.hitRate).toBeNull()
    expect(metrics.errors).toEqual([])
  })

  it('aggregates per model, busiest first', () => {
    const metrics = buildMetrics(
      {
        ...empty,
        inferencesByModel: { small: 1, big: 3 },
        durationsByModel: { big: [100, 200, 300], small: [50] },
        tokensPerSecondByModel: { big: [10, 20, 30], small: [5] },
      },
      config,
      12,
    )

    expect(metrics.inference.total).toBe(4)
    expect(metrics.inference.models.map((m) => m.model)).toEqual([
      'big',
      'small',
    ])
    expect(metrics.inference.models[0]).toEqual({
      model: 'big',
      inferences: 3,
      avgDurationMs: 200,
      p95DurationMs: 300,
      avgTokensPerSecond: 20,
    })
    expect(metrics.index.vectors).toBe(12)
  })

  it('computes the cache hit rate and sorts errors by count', () => {
    const metrics = buildMetrics(
      {
        ...empty,
        cacheHits: 1,
        cacheMisses: 3,
        errorsByType: { OLLAMA_TIMEOUT: 1, OLLAMA_INVALID_JSON: 4 },
      },
      config,
      0,
    )

    expect(metrics.cache.hitRate).toBe(0.25)
    expect(metrics.errors.map((e) => e.type)).toEqual([
      'OLLAMA_INVALID_JSON',
      'OLLAMA_TIMEOUT',
    ])
  })
})
