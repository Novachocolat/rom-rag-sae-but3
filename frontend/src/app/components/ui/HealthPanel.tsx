import { healthSchema, type Health } from '@repo/shared/schemas'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.js'
import { cn } from '@/lib/utils.js'

// Per-dependency display state, with `loading` for the pending first fetch
type Probe = 'loading' | 'up' | 'down'

// Tailwind classes for each state, for the badge background and text color
const PROBE_STYLE: Record<Probe, string> = {
  loading: 'bg-neutral-200 text-neutral-700',
  up: 'bg-green-100 text-green-800',
  down: 'bg-red-100 text-red-800',
}

const PROBE_LABEL: Record<Probe, string> = {
  loading: 'checking…', // Still fetching the first report, or the backend is unreachable
  up: 'up',
  down: 'down',
}

// A single badge for a dependency, showing its name and state
function Badge({ name, state }: { name: string; state: Probe }) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="font-medium">{name}</span>
      <span
        className={cn(
          'rounded px-2 py-0.5 text-sm tabular-nums',
          PROBE_STYLE[state],
        )}
      >
        {PROBE_LABEL[state]}
      </span>
    </li>
  )
}

// The main app currently only fetches the health report and renders a badge for each dependency
export default function HealthPanel() {
  const {
    data: health,
    isError,
    isLoading,
  } = useQuery<Health>({
    queryKey: ['health', 'report'],
    queryFn: async () => {
      const response = await apiClient<unknown>('/health')
      return healthSchema.parse(response)
    },
    refetchInterval: 1000 * 30,
  })

  const backend: Probe = isError ? 'down' : isLoading ? 'loading' : 'up'
  const postgres: Probe = isError
    ? 'down'
    : isLoading
      ? 'loading'
      : (health?.dependencies.postgres ?? 'loading')
  const redis: Probe = isError
    ? 'down'
    : isLoading
      ? 'loading'
      : (health?.dependencies.redis ?? 'loading')

  return (
    <main className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
      <header className="flex flex-col gap-1 mb-4">
        <h1 className="text-xl font-semibold">Stack status</h1>
        <p className="text-xs text-muted-foreground">
          Live report from <code>GET /api/health</code>.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        <Badge name="backend" state={backend} />
        <Badge name="postgresql" state={postgres} />
        <Badge name="redis" state={redis} />
      </ul>
    </main>
  )
}
