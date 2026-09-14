import { healthSchema, type Health } from '@repo/shared/schemas'
import { useEffect, useState } from 'react'
import { cn } from './lib/utils.js'

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
export default function App() {
  const [health, setHealth] = useState<Health | null>(null) // null means the first fetch is still pending
  const [failed, setFailed] = useState(false)

  // Fetches the health report once on mount, and abort it if the component unmounts
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setHealth(healthSchema.parse(body)))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [])

  const backend: Probe = failed ? 'down' : health ? 'up' : 'loading'
  const postgres: Probe = failed
    ? 'down'
    : (health?.dependencies.postgres ?? 'loading')
  const redis: Probe = failed
    ? 'down'
    : (health?.dependencies.redis ?? 'loading')

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Stack status</h1>
        <p className="text-sm text-neutral-500">
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
