import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card.tsx'
import { useMetrics } from '@/app/hooks/metrics/useMetrics.ts'
import {
  formatDuration,
  formatPercent,
  formatTokensPerSecond,
} from '@/lib/format.ts'

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h3>
      <dl className="text-sm">{children}</dl>
    </section>
  )
}

// Settings panel: how the AI stack is configured and how it behaves
export default function MetricsPanel() {
  const { data: metrics, isError, isLoading } = useMetrics()

  // Stats of the model currently configured (older models may still have samples)
  const active = metrics?.inference.models.find(
    (entry) => entry.model === metrics.config.llmModel,
  )

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>AI infrastructure</CardTitle>
        <CardDescription>
          Live report from <code>GET /api/metrics</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="text-sm text-destructive">
            The metrics could not be loaded.
          </p>
        )}
        {metrics && (
          <>
            <Section title="Models">
              <Row
                label="Language model"
                value={<code>{metrics.config.llmModel}</code>}
              />
              <Row
                label="Embedding model"
                value={<code>{metrics.config.embeddingModel}</code>}
              />
              <Row
                label="Embedding dimension"
                value={metrics.config.embeddingDimension}
              />
              <Row
                label="Context window"
                value={`${metrics.config.contextWindow} tokens`}
              />
              <Row label="Temperature" value={metrics.config.temperature} />
              <Row
                label="Thinking mode"
                value={metrics.config.thinking ? 'on' : 'off'}
              />
              <Row
                label="Confidence threshold"
                value={metrics.config.confidenceThreshold}
              />
            </Section>

            <Section title="Performance">
              <Row label="Inferences" value={active?.inferences ?? 0} />
              <Row
                label="Average duration"
                value={formatDuration(active?.avgDurationMs ?? null)}
              />
              <Row
                label="95th percentile"
                value={formatDuration(active?.p95DurationMs ?? null)}
              />
              <Row
                label="Average speed"
                value={formatTokensPerSecond(
                  active?.avgTokensPerSecond ?? null,
                )}
              />
              <Row
                label="Cache hit rate"
                value={`${formatPercent(metrics.cache.hitRate)} (${metrics.cache.hits}/${metrics.cache.hits + metrics.cache.misses})`}
              />
              <Row label="Indexed vectors" value={metrics.index.vectors} />
            </Section>

            {metrics.errors.length > 0 && (
              <Section title="Errors by type">
                {metrics.errors.map((error) => (
                  <Row
                    key={error.type}
                    label={error.type}
                    value={error.count}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
