import { randomUUID } from 'node:crypto'
import { env } from '../../env.js'
import { logger } from '../../lib/logger.js'
import {
  isRetryableOllamaError,
  OllamaContextOverflowError,
  OllamaInvalidJsonError,
  OllamaModelNotFoundError,
  OllamaServerError,
  OllamaTimeoutError,
  OllamaUnavailableError,
  type OllamaError,
} from './ollama.error.js'

// The only place in the backend that calls `fetch` against Ollama. Every LLM
// and embedding client goes through this module, so timeouts, retries and
// error classification only need to be correct once.

export interface OllamaRequestOptions {
  method?: string
  body?: unknown
  // Logged alongside every attempt; callers always know which model they target.
  model: string
}

const BASE_RETRY_DELAY_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Exponential backoff with jitter, so concurrent retries don't all land at
// the same instant: 250ms, 500ms, 1000ms, ... each ±50%.
function backoffDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * 2 ** attempt
  return base + Math.random() * base
}

// Maps a non-2xx HTTP response to the Ollama error taxonomy
function classifyHttpError(
  status: number,
  bodyText: string,
  path: string,
): OllamaError {
  if (status === 404 && /model .*not found/i.test(bodyText)) {
    return new OllamaModelNotFoundError('Ollama model is not available', {
      path,
      status,
      body: bodyText,
    })
  }

  if (/context length|out of memory/i.test(bodyText)) {
    return new OllamaContextOverflowError(
      'Ollama request exceeds the model context window',
      { path, status, body: bodyText },
    )
  }

  if (status === 502 || status === 503) {
    return new OllamaUnavailableError('Ollama is unavailable', {
      path,
      status,
      body: bodyText,
    })
  }

  return new OllamaServerError('Ollama returned an unexpected error', {
    path,
    status,
    body: bodyText,
  })
}

// Maps a failure that happened before a response was received (network error,
// or our own timeout) to the Ollama error taxonomy
function classifyFetchError(err: unknown, path: string): OllamaError {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new OllamaTimeoutError(
      `Ollama did not respond within ${env.OLLAMA_TIMEOUT_MS}ms`,
      { path },
    )
  }

  return new OllamaUnavailableError('Ollama is not reachable', {
    path,
    cause: err instanceof Error ? err.message : String(err),
  })
}

// A single attempt: no retry logic here, just fetch + classify + log
async function performRequest<T>(
  path: string,
  options: OllamaRequestOptions,
  requestId: string,
): Promise<T> {
  const url = `${env.OLLAMA_BASE_URL}${path}`
  const startedAt = Date.now()

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: { 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS),
    })
  } catch (err) {
    throw classifyFetchError(err, path)
  }

  const durationMs = Date.now() - startedAt
  const bodyText = await response.text()

  if (!response.ok) {
    throw classifyHttpError(response.status, bodyText, path)
  }

  logger.info('Ollama call succeeded', {
    requestId,
    model: options.model,
    path,
    durationMs,
  })

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new OllamaInvalidJsonError('Ollama response is not valid JSON', {
      path,
      body: bodyText.slice(0, 500),
    })
  }
}

/**
 * POSTs (or sends) `path` to Ollama and returns its parsed JSON body.
 * Retries with exponential backoff + jitter on OllamaServerError and
 * OllamaUnavailableError only, up to env.OLLAMA_MAX_RETRIES times.
 */
export async function ollamaRequest<T = unknown>(
  path: string,
  options: OllamaRequestOptions,
): Promise<T> {
  // Shared across every retry of this call, so logs can be correlated
  const requestId = randomUUID()

  for (let attempt = 0; attempt <= env.OLLAMA_MAX_RETRIES; attempt++) {
    try {
      return await performRequest<T>(path, options, requestId)
    } catch (err) {
      const isLastAttempt = attempt === env.OLLAMA_MAX_RETRIES
      if (!isRetryableOllamaError(err) || isLastAttempt) {
        logger.error('Ollama call failed', {
          requestId,
          model: options.model,
          path,
          attempt,
          code: err instanceof Error ? err.name : 'UnknownError',
        })
        throw err
      }

      const delayMs = backoffDelay(attempt)
      logger.warn('Retrying Ollama call', {
        requestId,
        model: options.model,
        path,
        attempt,
        delayMs,
      })
      await sleep(delayMs)
    }
  }

  // Unreachable: the loop above always returns or throws
  throw new OllamaServerError('Ollama request exhausted its retries', {
    path,
  })
}
