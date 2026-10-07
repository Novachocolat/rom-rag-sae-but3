import { createHash } from 'node:crypto'
import { romIdentificationSchema } from '@repo/shared/schemas'
import { z } from 'zod'
import { env } from '../env.js'
import { redis } from '../lib/redis.js'

// The raw model output is cached, not the decision made on it: a cache hit
// still goes through the same coherence and threshold checks
export const cachedIdentificationSchema = z.object({
  data: romIdentificationSchema,
  raw: z.string(),
  model: z.string(),
  durationMs: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  tokensPerSecond: z.number(),
})

export type CachedIdentification = z.infer<typeof cachedIdentificationSchema>

export interface AiCacheKeyInput {
  kind: string
  model: string
  promptName: string
  promptVersion: string
  renderedPrompt: string
}

// Model and prompt version are part of the key, so changing either one
// invalidates the cache instead of serving an answer from the old prompt.
// NUL separators keep ("ab", "c") and ("a", "bc") from colliding.
export function buildAiCacheKey(input: AiCacheKeyInput): string {
  const digest = createHash('sha256')
    .update(
      [
        input.model,
        input.promptName,
        input.promptVersion,
        input.renderedPrompt,
      ].join('\u0000'),
    )
    .digest('hex')

  return `ai:${input.kind}:${digest}`
}

// A corrupt or outdated entry counts as a miss rather than an error
export async function getCachedIdentification(
  key: string,
): Promise<CachedIdentification | null> {
  const raw = await redis.get(key)
  if (raw === null) return null

  try {
    const parsed = cachedIdentificationSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function setCachedIdentification(
  key: string,
  value: CachedIdentification,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', env.AI_CACHE_TTL_SECONDS)
}
