import { describe, expect, it } from 'vitest'
import {
  loadPrompt,
  PromptNotFoundError,
  PromptVariableMissingError,
  renderTemplate,
} from './prompt-loader.js'

// Tests for the prompt loader, which reads versioned files from prompts/
describe('loadPrompt', () => {
  it('loads the identification prompt shipped in the repo', () => {
    const template = loadPrompt('identification', 'v1')

    expect(template).toContain('{{fileName}}')
    expect(template).toContain('{{candidates}}')
  })

  it('throws PromptNotFoundError for an unknown version', () => {
    expect(() => loadPrompt('identification', 'v999')).toThrow(
      PromptNotFoundError,
    )
  })
})

describe('renderTemplate', () => {
  it('replaces every placeholder with its value', () => {
    const rendered = renderTemplate('{{a}} and {{a}} then {{b}}', {
      a: 'x',
      b: 'y',
    })

    expect(rendered).toBe('x and x then y')
  })

  it('throws PromptVariableMissingError when a placeholder has no value', () => {
    expect(() => renderTemplate('Hello {{name}}', {})).toThrow(
      PromptVariableMissingError,
    )
  })

  it('leaves text without placeholders untouched', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text')
  })
})
