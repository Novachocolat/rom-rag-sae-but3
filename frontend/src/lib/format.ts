// Display helpers shared by the metrics panel and the inference footers
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatTokensPerSecond(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} tok/s`
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`
}
