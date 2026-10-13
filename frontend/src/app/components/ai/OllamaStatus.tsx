import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/ui/tooltip'
import {
  useOllamaStatus,
  type OllamaAvailability,
} from '@/app/hooks/ai/useOllamaStatus'
import { cn } from '@/lib/utils'

const STATUS_STYLE: Record<OllamaAvailability, { dot: string; label: string }> =
  {
    checking: { dot: 'animate-pulse bg-neutral-400', label: 'Checking…' },
    up: { dot: 'bg-green-500', label: 'Available' },
    down: { dot: 'bg-red-500', label: 'Unavailable' },
  }

// Component to display Ollama's availability in the header
export function OllamaStatus() {
  const { status, disabledReason } = useOllamaStatus()
  const style = STATUS_STYLE[status]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="status"
            tabIndex={0}
            className="flex items-center gap-2 rounded-md text-sm font-medium"
          />
        }
      >
        <span>Ollama status:</span>
        <span
          aria-hidden
          className={cn('inline-flex h-2.5 w-2.5 rounded-full', style.dot)}
        />
        <span className="text-xs text-muted-foreground">{style.label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {disabledReason ?? 'Ollama is reachable: AI actions are available.'}
      </TooltipContent>
    </Tooltip>
  )
}
