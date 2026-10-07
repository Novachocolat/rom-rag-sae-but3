import { env } from '../../env.js'

// Both probes bypass ollama-http.ts on purpose: they must fail fast and
// never retry, so a down Ollama doesn't slow down /api/health or /settings.
const PROBE_TIMEOUT_MS = 3000

export interface OllamaPing {
  up: boolean
  version?: string
  latencyMs: number
}

/**
 * Lightest possible probe, for the header status indicator: just asks for
 * the server version, no model listing.
 */
export async function pingOllama(): Promise<OllamaPing> {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const latencyMs = Date.now() - startedAt

    if (!response.ok) return { up: false, latencyMs }

    const body = (await response.json()) as { version?: string }
    return { up: true, version: body.version, latencyMs }
  } catch {
    return { up: false, latencyMs: Date.now() - startedAt }
  }
}

export interface OllamaModelStatus {
  name: string
  present: boolean
}

export interface OllamaCheck {
  status: 'ok' | 'degraded'
  models: OllamaModelStatus[]
  latencyMs: number
}

// Models this app actually needs; checkOllama reports which ones are missing
function configuredModels(): string[] {
  return [env.OLLAMA_LLM_MODEL, env.OLLAMA_EMBEDDING_MODEL]
}

function allMissing(latencyMs: number): OllamaCheck {
  return {
    status: 'degraded',
    models: configuredModels().map((name) => ({ name, present: false })),
    latencyMs,
  }
}

/**
 * Heavier probe for /settings and diagnostics: confirms the models this app
 * is configured to use are actually pulled on the Ollama instance.
 */
export async function checkOllama(): Promise<OllamaCheck> {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const latencyMs = Date.now() - startedAt

    if (!response.ok) return allMissing(latencyMs)

    const body = (await response.json()) as { models?: { name: string }[] }
    const availableNames = new Set((body.models ?? []).map((m) => m.name))
    const models = configuredModels().map((name) => ({
      name,
      present: availableNames.has(name),
    }))

    return {
      status: models.every((m) => m.present) ? 'ok' : 'degraded',
      models,
      latencyMs,
    }
  } catch {
    return allMissing(Date.now() - startedAt)
  }
}
