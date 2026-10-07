import { beforeAll, describe, expect, it } from 'vitest'
import {
  loadPrompts,
  getPrompt,
  renderPrompt,
} from './prompt-loader.service.js'

describe('prompt-loader', () => {
  beforeAll(async () => {
    await loadPrompts()
  })

  describe('loadPrompts / getPrompt', () => {
    it('loads the identification prompt with its front matter', () => {
      const prompt = getPrompt('identification')

      expect(prompt.name).toBe('identification')
      expect(prompt.version).toBe('v1')
      expect(prompt.model).toBeTruthy()
      expect(prompt.temperature).toBe(0.1)
      expect(prompt.description).toBeTruthy()
      expect(prompt.changelog).toEqual(['v1: initial version'])
    })

    it('loads the grouping and summary prompts too', () => {
      expect(getPrompt('grouping').name).toBe('grouping')
      expect(getPrompt('summary').name).toBe('summary')
    })

    it('does not load README.md as a prompt', () => {
      expect(() => getPrompt('README')).toThrow()
    })

    it('splits system and user sections', () => {
      const prompt = getPrompt('identification')

      expect(prompt.system).toContain('ROM identification assistant')
      expect(prompt.system).not.toContain('# User')
      expect(prompt.userTemplate).toContain('{{romFileName}}')
    })

    it('throws for an unknown prompt name', () => {
      expect(() => getPrompt('does-not-exist')).toThrow(/Unknown prompt/)
    })
  })

  describe('renderPrompt', () => {
    it('substitutes every variable in the user template', () => {
      const rendered = renderPrompt('identification', {
        romFileName: 'Sonic.md',
        platformName: 'Mega Drive',
        fileSize: '524288',
        candidates: '- Sonic the Hedgehog (World)',
      })

      expect(rendered.user).toContain('Sonic.md')
      expect(rendered.user).toContain('Mega Drive')
      expect(rendered.user).toContain('524288')
      expect(rendered.user).toContain('Sonic the Hedgehog (World)')
      expect(rendered.user).not.toMatch(/\{\{\w+\}\}/)
    })

    it('returns the system message, model and temperature alongside the rendered user prompt', () => {
      const rendered = renderPrompt('identification', {
        romFileName: 'a',
        platformName: 'b',
        fileSize: 'c',
        candidates: 'd',
      })

      expect(rendered.system).toBeTruthy()
      expect(rendered.model).toBeTruthy()
      expect(rendered.temperature).toBe(0.1)
    })

    it('throws loudly instead of leaving a literal {{key}} when a variable is missing', () => {
      expect(() =>
        renderPrompt('identification', {
          romFileName: 'Sonic.md',
          // platformName intentionally missing
          fileSize: '524288',
          candidates: '-',
        } as Record<string, string>),
      ).toThrow(/Missing variable "platformName"/)
    })

    it('renders the grouping prompt', () => {
      const rendered = renderPrompt('grouping', {
        romFileName: 'Super Mario Kart',
        platformName: 'SNES',
        candidates: '- Super Mario Kart (Europe)',
      })

      expect(rendered.user).toContain('Super Mario Kart')
      expect(rendered.user).not.toMatch(/\{\{\w+\}\}/)
    })

    it('renders the summary prompt', () => {
      const rendered = renderPrompt('summary', {
        romFileName: 'Sonic the Hedgehog',
        platformName: 'Mega Drive',
        fileSize: '524288',
        candidates: '-',
      })

      expect(rendered.user).toContain('Sonic the Hedgehog')
      expect(rendered.user).not.toMatch(/\{\{\w+\}\}/)
    })
  })
})
