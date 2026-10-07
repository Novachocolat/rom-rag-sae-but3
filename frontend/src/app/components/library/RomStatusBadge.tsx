import { Badge } from '@/app/components/ui/badge'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/tooltip'
import type { IdentificationSource } from '@repo/shared/types'

// Maps an identification source to a UI status badge
const CONFIG: Record<
  IdentificationSource,
  { label: string; className: string; tooltip?: string }
> = {
  DAT_SHA1: { label: 'DAT (SHA1)', className: 'bg-green-600 text-white' },
  DAT_MD5: { label: 'DAT (MD5)', className: 'bg-green-600 text-white' },
  DAT_SHA1_DATA: {
    label: 'DAT (data SHA1)',
    className: 'bg-green-200 text-green-900',
    tooltip: 'Reliable, but the file header differs from the DAT',
  },
  DAT_MD5_DATA: {
    label: 'DAT (data MD5)',
    className: 'bg-green-200 text-green-900',
    tooltip: 'Reliable, but the file header differs from the DAT',
  },
  DAT_NAME: { label: 'DAT (name)', className: 'bg-green-100 text-green-900' },
  AI_PROPOSED: {
    label: 'Suggested by AI',
    className: 'bg-amber-500 text-white',
  },
  USER_CONFIRMED: { label: 'Confirmed', className: 'bg-blue-600 text-white' },
  UNIDENTIFIED: {
    label: 'Unidentified',
    className: 'bg-muted text-muted-foreground',
  },
}

// Component to show a status badge for each ROM with its identification source
export function RomStatusBadge({ source }: { source: IdentificationSource }) {
  const config = CONFIG[source]
  const badge = <Badge className={config.className}>{config.label}</Badge>

  if (!config.tooltip) return badge

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent>{config.tooltip}</TooltipContent>
    </Tooltip>
  )
}
