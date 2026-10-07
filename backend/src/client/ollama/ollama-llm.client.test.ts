import { z } from 'zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { ollamaRequest } from './ollama-http.js'
import { ollamaLlmClient } from './ollama-llm.client.js'
import { OllamaInvalidJsonError } from './ollama.error.js'

vi.mock('./ollama-http.js', () => ({ ollamaRequest: vi.fn() }))

const mockedRequest = vi.mocked(ollamaRequest)

// Ollama's raw response shape, nanoseconds and counts
function fakeOllamaResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    model: env.OLLAMA_LLM_MODEL,
    response: '{"title":"Sonic the Hedgehog"}',
    total_duration: 2_000_000_000, // 2s
    prompt_eval_count: 10,
    eval_count: 20,
    eval_duration: 1_000_000_000, // 1s -> 20 tokens/s
    ...overrides,
  }
}

const titleSchema = z.object({ title: z.string() })

describe('ollamaLlmClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('generateJson', () => {
    it('sends the model, prompt, format and sampling options to /api/generate', async () => {
      mockedRequest.mockResolvedValue(fakeOllamaResponse())

      await ollamaLlmClient.generateJson({
        prompt: 'Identify this ROM',
        system: 'You are a ROM identifier',
        schema: titleSchema,
      })

      expect(mockedRequest).toHaveBeenCalledWith('/api/generate', {
        model: env.OLLAMA_LLM_MODEL,
        body: {
          model: env.OLLAMA_LLM_MODEL,
          prompt: 'Identify this ROM',
          system: 'You are a ROM identifier',
          stream: false,
          format: z.toJSONSchema(titleSchema),
          think: env.OLLAMA_THINKING,
          options: {
            temperature: env.OLLAMA_TEMPERATURE,
            num_ctx: env.OLLAMA_NUM_CTX,
          },
        },
      })
    })

    it('converts nanosecond durations and counts into our metrics (the 1e6/1e9 factor)', async () => {
      mockedRequest.mockResolvedValue(fakeOllamaResponse())

      const result = await ollamaLlmClient.generateJson({
        prompt: 'x',
        schema: titleSchema,
      })

      expect(result.durationMs).toBe(2000)
      expect(result.promptTokens).toBe(10)
      expect(result.completionTokens).toBe(20)
      expect(result.tokensPerSecond).toBe(20)
      expect(result.fromCache).toBe(false)
      expect(result.model).toBe(env.OLLAMA_LLM_MODEL)
    })

    it('parses and validates `response` against the schema, exposing both `data` and `raw`', async () => {
      mockedRequest.mockResolvedValue(fakeOllamaResponse())

      const result = await ollamaLlmClient.generateJson({
        prompt: 'x',
        schema: titleSchema,
      })

      expect(result.data).toEqual({ title: 'Sonic the Hedgehog' })
      expect(result.raw).toBe('{"title":"Sonic the Hedgehog"}')
    })

    it('never concatenates the separate `thinking` field into the parsed JSON', async () => {
      mockedRequest.mockResolvedValue(
        fakeOllamaResponse({ thinking: 'Let me think about this...' }),
      )

      const result = await ollamaLlmClient.generateJson({
        prompt: 'x',
        schema: titleSchema,
      })

      expect(result.raw).not.toContain('think')
      expect(result.data).toEqual({ title: 'Sonic the Hedgehog' })
    })

    it('throws OllamaInvalidJsonError when `response` is not valid JSON', async () => {
      mockedRequest.mockResolvedValue(
        fakeOllamaResponse({ response: 'definitely not json' }),
      )

      await expect(
        ollamaLlmClient.generateJson({ prompt: 'x', schema: titleSchema }),
      ).rejects.toBeInstanceOf(OllamaInvalidJsonError)
    })

    it('throws OllamaInvalidJsonError when the JSON does not match the schema', async () => {
      mockedRequest.mockResolvedValue(
        fakeOllamaResponse({ response: JSON.stringify({ wrongField: 1 }) }),
      )

      await expect(
        ollamaLlmClient.generateJson({ prompt: 'x', schema: titleSchema }),
      ).rejects.toBeInstanceOf(OllamaInvalidJsonError)
    })

    it('guards against a zero eval_duration instead of dividing by zero', async () => {
      mockedRequest.mockResolvedValue(
        fakeOllamaResponse({ eval_count: 0, eval_duration: 0 }),
      )

      const result = await ollamaLlmClient.generateJson({
        prompt: 'x',
        schema: titleSchema,
      })

      expect(result.tokensPerSecond).toBe(0)
    })
  })

  describe('generateText', () => {
    it('sends no `format` field and returns the raw text with metrics', async () => {
      mockedRequest.mockResolvedValue(
        fakeOllamaResponse({ response: 'Plain text answer' }),
      )

      const result = await ollamaLlmClient.generateText({ prompt: 'x' })

      const [, options] = mockedRequest.mock.calls[0] ?? []
      expect(options?.body).not.toHaveProperty('format')
      expect(result.text).toBe('Plain text answer')
      expect(result.durationMs).toBe(2000)
    })
  })
})
