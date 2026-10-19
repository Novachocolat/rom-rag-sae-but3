import type { InferenceStats } from '@repo/shared/types'
import { formatDuration, formatTokensPerSecond } from '@/lib/format'

interface InferenceMetaProps {
  model: string
  promptName: string
  promptVersion: string
  inference: InferenceStats
}

// Footer of an AI result: which model and prompt produced it, and what it cost
export function InferenceMeta({
  model,
  promptName,
  promptVersion,
  inference,
}: InferenceMetaProps) {
  const { durationMs, tokensPerSecond, fromCache } = inference

  return (
    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
      <span>
        Model <code>{model}</code>
      </span>
      <span>
        Prompt{' '}
        <code>
          {promptName}@{promptVersion}
        </code>
      </span>
      <span
        title={
          fromCache
            ? 'Duration of the original call: this answer was served from the cache'
            : undefined
        }
      >
        {formatDuration(durationMs)}
      </span>
      <span>{formatTokensPerSecond(tokensPerSecond)}</span>
      <span>Cache: {fromCache === null ? '—' : fromCache ? 'yes' : 'no'}</span>
    </p>
  )
}
