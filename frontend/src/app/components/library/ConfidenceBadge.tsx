import { cn } from '@/lib/utils'

type ConfidenceLevel = 'low' | 'medium' | 'high'

const LEVEL_STYLE: Record<
  ConfidenceLevel,
  { label: string; bar: string; text: string }
> = {
  low: { label: 'Low', bar: 'bg-red-500', text: 'text-red-700' },
  medium: { label: 'Medium', bar: 'bg-amber-500', text: 'text-amber-700' },
  high: { label: 'High', bar: 'bg-green-600', text: 'text-green-700' },
}

// Below 0.5 is low, 0.5 to 0.75 included is medium, above 0.75 is high
function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence < 0.5) return 'low'
  if (confidence <= 0.75) return 'medium'
  return 'high'
}

interface ConfidenceBadgeProps {
  confidence: number | null
  className?: string
}

// Component to show a confidence score as a gauge, a level and the raw number:
// the level is never shown without the score it was derived from
export function ConfidenceBadge({
  confidence,
  className,
}: ConfidenceBadgeProps) {
  if (confidence == null) {
    return <span className="text-muted-foreground">—</span>
  }

  const style = LEVEL_STYLE[confidenceLevel(confidence)]
  const percent = Math.round(Math.min(1, Math.max(0, confidence)) * 100)

  return (
    <span
      className={cn('inline-flex items-center gap-2 text-xs', className)}
      title={`Raw confidence score: ${confidence}`}
    >
      <span
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={confidence}
        aria-valuetext={`${style.label}, ${confidence.toFixed(2)}`}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn('block h-full rounded-full', style.bar)}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className={cn('font-medium', style.text)}>{style.label}</span>
      <span className="text-muted-foreground tabular-nums">
        {confidence.toFixed(2)}
      </span>
    </span>
  )
}
