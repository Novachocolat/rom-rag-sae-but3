import type { Metrics, ModelMetrics } from '@repo/shared/types'
import type { RawMetrics } from '../storage/metrics.storage.js'

const P95 = 0.95

export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// Nearest-rank percentile: the smallest sample that covers `p` of the samples
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null
}

/**
 * Turns the raw Redis counters into the report served by GET /api/metrics.
 * Averages and p95 cover the latest samples only; counters cover everything.
 */
export function buildMetrics(
  raw: RawMetrics,
  config: Metrics['config'],
  vectors: number,
): Metrics {
  const models: ModelMetrics[] = Object.entries(raw.inferencesByModel)
    .map(([model, inferences]) => {
      const durations = raw.durationsByModel[model] ?? []
      return {
        model,
        inferences,
        avgDurationMs: average(durations),
        p95DurationMs: percentile(durations, P95),
        avgTokensPerSecond: average(raw.tokensPerSecondByModel[model] ?? []),
      }
    })
    .sort((a, b) => b.inferences - a.inferences)

  const lookups = raw.cacheHits + raw.cacheMisses

  return {
    config,
    inference: {
      total: models.reduce((sum, model) => sum + model.inferences, 0),
      models,
    },
    cache: {
      hits: raw.cacheHits,
      misses: raw.cacheMisses,
      hitRate: lookups > 0 ? raw.cacheHits / lookups : null,
    },
    errors: Object.entries(raw.errorsByType)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    index: { vectors },
  }
}
