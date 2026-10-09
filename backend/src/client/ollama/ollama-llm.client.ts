import { z } from 'zod'
import { env } from '../../env.js'
import { ollamaRequest } from './ollama-http.js'
import { OllamaInvalidJsonError } from './ollama.error.js'
import type {
  GenerateJsonOptions,
  GenerateTextOptions,
  LlmClient,
  LlmJsonResult,
  LlmTextResult,
} from './ollama.types.js'

// Shape of Ollama's POST /api/generate response.
// `thinking` only appears when `think: true` was requested, and is never the
// same thing as `response`: it's the model's reasoning trace, not its output.
interface OllamaGenerateResponse {
  model: string
  response: string
  thinking?: string
  total_duration: number
  prompt_eval_count: number
  eval_count: number
  eval_duration: number
}

// Converts Ollama's nanosecond/count fields into our millisecond/tokens-per-
// second metrics. Getting the 1e6/1e9 factors wrong silently inflates every
// duration shown in the UI by a thousand, on a criterion that's explicitly graded.
function extractMetrics(res: OllamaGenerateResponse) {
  const evalDurationSeconds = res.eval_duration / 1e9
  return {
    model: res.model,
    durationMs: res.total_duration / 1e6,
    promptTokens: res.prompt_eval_count,
    completionTokens: res.eval_count,
    tokensPerSecond:
      evalDurationSeconds > 0 ? res.eval_count / evalDurationSeconds : 0,
    fromCache: false,
  }
}

async function generateJson<T>(
  opts: GenerateJsonOptions<T>,
): Promise<LlmJsonResult<T>> {
  const response = await ollamaRequest<OllamaGenerateResponse>(
    '/api/generate',
    {
      model: env.OLLAMA_LLM_MODEL,
      body: {
        model: env.OLLAMA_LLM_MODEL,
        prompt: opts.prompt,
        system: opts.system,
        stream: false,
        // Same schema both constrains the model's output and validates it below
        format: z.toJSONSchema(opts.schema),
        think: env.OLLAMA_THINKING,
        options: {
          temperature: env.OLLAMA_TEMPERATURE,
          num_ctx: env.OLLAMA_NUM_CTX,
        },
      },
    },
  )

  const raw = response.response

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new OllamaInvalidJsonError(
      'Ollama returned non-JSON content for a generateJson call',
      { raw },
    )
  }

  const result = opts.schema.safeParse(parsed)
  if (!result.success) {
    throw new OllamaInvalidJsonError(
      "Ollama's JSON output failed schema validation",
      { issues: result.error.issues, raw },
    )
  }

  return { data: result.data, raw, ...extractMetrics(response) }
}

async function generateText(opts: GenerateTextOptions): Promise<LlmTextResult> {
  const response = await ollamaRequest<OllamaGenerateResponse>(
    '/api/generate',
    {
      model: env.OLLAMA_LLM_MODEL,
      body: {
        model: env.OLLAMA_LLM_MODEL,
        prompt: opts.prompt,
        system: opts.system,
        stream: false,
        think: env.OLLAMA_THINKING,
        options: {
          temperature: env.OLLAMA_TEMPERATURE,
          num_ctx: env.OLLAMA_NUM_CTX,
        },
      },
    },
  )

  return { text: response.response, ...extractMetrics(response) }
}

export const ollamaLlmClient: LlmClient = { generateJson, generateText }
