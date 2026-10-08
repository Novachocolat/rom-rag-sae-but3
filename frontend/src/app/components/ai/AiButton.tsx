import type { ComponentProps } from 'react'
import { Button } from '@/app/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/app/components/ui/tooltip'
import { useOllamaStatus } from '@/app/hooks/ai/useOllamaStatus'
import { cn } from '@/lib/utils'

// Button for any action that needs an inference
// While Ollama is not available, it is disabled and says why
export function AiButton({
  disabled,
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const { isUp, disabledReason } = useOllamaStatus()

  if (isUp) {
    return (
      <Button disabled={disabled} className={className} {...props}>
        {children}
      </Button>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            {...props}
            disabled
            focusableWhenDisabled
            className={cn(
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  )
}
