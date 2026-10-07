import { readFileSync } from 'node:fs'
import path from 'node:path'

// Prompts live in the repo-root `prompts/` folder, as `<name>.<version>.md`,
// so a prompt change goes through a reviewed, versioned file
const PROMPTS_DIR = path.resolve(import.meta.dirname, '../../../prompts')

export class PromptNotFoundError extends Error {
  constructor(name: string, version: string) {
    super(`Prompt file not found: ${name}.${version}.md`)
    this.name = 'PromptNotFoundError'
  }
}

export class PromptVariableMissingError extends Error {
  constructor(variable: string) {
    super(`Prompt variable is missing: ${variable}`)
    this.name = 'PromptVariableMissingError'
  }
}

const templates = new Map<string, string>()

// Reads a prompt once and keeps it in memory for the rest of the process
export function loadPrompt(name: string, version: string): string {
  const key = `${name}.${version}`
  const cached = templates.get(key)
  if (cached !== undefined) return cached

  let template: string
  try {
    template = readFileSync(path.join(PROMPTS_DIR, `${key}.md`), 'utf8')
  } catch {
    throw new PromptNotFoundError(name, version)
  }

  templates.set(key, template)
  return template
}

// Replaces every `{{name}}` placeholder; a placeholder without a value fails
// loudly instead of sending the model a literal "{{name}}"
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, variable: string) => {
    const value = variables[variable]
    if (value === undefined) throw new PromptVariableMissingError(variable)
    return value
  })
}
