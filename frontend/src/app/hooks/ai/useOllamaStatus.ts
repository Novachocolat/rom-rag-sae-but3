import { useHealth } from '@/app/hooks/health/useHealth.ts'

export type OllamaAvailability = 'checking' | 'up' | 'down'

// Hook to derive Ollama's availability from the health report
// `disabledReason` is the sentence shown next to any AI action that cannot run, null when Ollama is available
export function useOllamaStatus() {
  const { data, isError } = useHealth()

  // No report at all means the backend itself is unreachable, so is Ollama
  const status: OllamaAvailability = isError
    ? 'down'
    : (data?.dependencies.ollama ?? 'checking')

  let disabledReason: string | null = null
  if (isError) {
    disabledReason =
      'The server is unreachable, so AI actions are disabled for now.'
  } else if (status === 'down') {
    disabledReason =
      'Ollama is unreachable: AI actions are disabled until it is back. The rest of the app keeps working.'
  } else if (status === 'checking') {
    disabledReason = 'Checking whether Ollama is available…'
  }

  return { status, isUp: status === 'up', disabledReason }
}
