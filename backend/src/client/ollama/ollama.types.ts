import type { z } from 'zod'

/**
 * Single inference interface: swapping Ollama for another provider only means
 * writing a new LlmClient, nothing else in the app changes.
 */
export interface LlmClient {
  generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmJsonResult<T>>
  generateText(opts: GenerateTextOptions): Promise<LlmTextResult>
}

// Single inference interface for text embeddings, mirroring LlmClient
export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
  readonly dimension: number
}

export interface GenerateJsonOptions<T> {
  prompt: string
  system?: string
  // Shapes the `format` field sent to Ollama (via z.toJSONSchema) and
  // validates the response before it is handed back to the caller.
  schema: z.ZodType<T>
}

export interface GenerateTextOptions {
  prompt: string
  system?: string
}

// Inference metrics shared by every LlmClient result. Collected from this
// first implementation so later sprints don't have to retrofit instrumentation:
// inference time and tokens/second are a graded requirement, not decoration.
interface LlmMetrics {
  model: string
  durationMs: number
  promptTokens: number
  completionTokens: number
  tokensPerSecond: number
  // Always false here; a caching layer wraps this client in a later sprint.
  fromCache: boolean
}

export interface LlmJsonResult<T> extends LlmMetrics {
  data: T
  raw: string
}

export interface LlmTextResult extends LlmMetrics {
  text: string
}
