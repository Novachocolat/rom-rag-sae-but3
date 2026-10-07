import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import type {
  EmbeddingClient,
  LlmClient,
  LlmJsonResult,
  LlmTextResult,
} from './ollama.types.js'

// The file only declares types, so these checks run at compile time (tsc -b)
// and the runtime assertion just makes sure the suite registers them
describe('Ollama interface contracts', () => {
  it('LlmClient exposes generateJson and generateText', () => {
    expectTypeOf<LlmClient>().toHaveProperty('generateJson')
    expectTypeOf<LlmClient>().toHaveProperty('generateText')
  })

  it('LlmJsonResult carries the typed data, the raw text and every metric', () => {
    const schema = z.object({ title: z.string() })
    expectTypeOf<LlmJsonResult<z.infer<typeof schema>>>().toEqualTypeOf<{
      data: { title: string }
      raw: string
      model: string
      durationMs: number
      promptTokens: number
      completionTokens: number
      tokensPerSecond: number
      fromCache: boolean
    }>()
  })

  it('LlmTextResult carries the text and the same metrics', () => {
    expectTypeOf<LlmTextResult>().toEqualTypeOf<{
      text: string
      model: string
      durationMs: number
      promptTokens: number
      completionTokens: number
      tokensPerSecond: number
      fromCache: boolean
    }>()
  })

  it('EmbeddingClient exposes embed and a readonly dimension', () => {
    expectTypeOf<EmbeddingClient>().toHaveProperty('embed')
    expectTypeOf<EmbeddingClient['dimension']>().toEqualTypeOf<number>()
  })
})
