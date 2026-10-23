import { logger } from '../lib/logger.js'
import { redis } from '../lib/redis.js'

// Only the latest samples of each model are kept, so Redis memory stays bounded
export const METRICS_SAMPLE_WINDOW = 1000

const KEYS = {
  inferences: 'metrics:inferences', // hash: model -> count
  errors: 'metrics:errors', // hash: error code -> count
  cacheHits: 'metrics:cache:hits',
  cacheMisses: 'metrics:cache:misses',
  durations: (model: string) => `metrics:durations:${model}`, // list, newest first
  speeds: (model: string) => `metrics:tps:${model}`, // list, newest first
}

export interface InferenceSample {
  model: string
  durationMs: number
  tokensPerSecond: number
}

// Raw counters and samples as stored, aggregated by metrics.service
export interface RawMetrics {
  inferencesByModel: Record<string, number>
  durationsByModel: Record<string, number[]>
  tokensPerSecondByModel: Record<string, number[]>
  cacheHits: number
  cacheMisses: number
  errorsByType: Record<string, number>
}

// Metrics are a side channel: a Redis failure must never fail the inference it measures
async function bestEffort(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (err) {
    logger.warn('Metrics write failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

// Counts one successful inference and keeps its duration and speed (LPUSH + LTRIM)
export function recordInference(sample: InferenceSample): Promise<void> {
  return bestEffort(() =>
    redis
      .multi()
      .hincrby(KEYS.inferences, sample.model, 1)
      .lpush(KEYS.durations(sample.model), sample.durationMs)
      .ltrim(KEYS.durations(sample.model), 0, METRICS_SAMPLE_WINDOW - 1)
      .lpush(KEYS.speeds(sample.model), sample.tokensPerSecond)
      .ltrim(KEYS.speeds(sample.model), 0, METRICS_SAMPLE_WINDOW - 1)
      .exec(),
  )
}

export function recordError(type: string): Promise<void> {
  return bestEffort(() => redis.hincrby(KEYS.errors, type, 1))
}

export function recordCacheLookup(hit: boolean): Promise<void> {
  return bestEffort(() => redis.incr(hit ? KEYS.cacheHits : KEYS.cacheMisses))
}

function toCounts(hash: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(hash).map(([key, value]) => [key, Number(value)]),
  )
}

function toNumbers(values: string[]): number[] {
  return values.map(Number).filter(Number.isFinite)
}

export async function readRawMetrics(): Promise<RawMetrics> {
  const [inferences, errors, hits, misses] = await Promise.all([
    redis.hgetall(KEYS.inferences),
    redis.hgetall(KEYS.errors),
    redis.get(KEYS.cacheHits),
    redis.get(KEYS.cacheMisses),
  ])

  const models = Object.keys(inferences)
  const [durations, speeds] = await Promise.all([
    Promise.all(
      models.map((model) => redis.lrange(KEYS.durations(model), 0, -1)),
    ),
    Promise.all(models.map((model) => redis.lrange(KEYS.speeds(model), 0, -1))),
  ])

  return {
    inferencesByModel: toCounts(inferences),
    durationsByModel: Object.fromEntries(
      models.map((model, i) => [model, toNumbers(durations[i] ?? [])]),
    ),
    tokensPerSecondByModel: Object.fromEntries(
      models.map((model, i) => [model, toNumbers(speeds[i] ?? [])]),
    ),
    cacheHits: Number(hits ?? 0),
    cacheMisses: Number(misses ?? 0),
    errorsByType: toCounts(errors),
  }
}
