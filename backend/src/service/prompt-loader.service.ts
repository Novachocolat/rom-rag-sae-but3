import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface PromptMeta {
  name: string
  version: string
  model: string
  temperature: number
  description: string
  changelog: string[]
}

export interface Prompt extends PromptMeta {
  system: string
  userTemplate: string
}

const PROMPTS_DIR = path.resolve(import.meta.dirname, '../../../prompts')

const cache = new Map<string, Prompt>()
let loaded = false

function parseFrontMatter(raw: string): {
  meta: Record<string, unknown>
  body: string
} {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!match) {
    throw new Error('Prompt file is missing its YAML front matter')
  }
  const [, yamlBlock, body] = match as unknown as [string, string, string]

  const meta: Record<string, unknown> = {}
  // Tracks what the following indented lines belong to: a list (changelog)
  // or a folded scalar (description: >), since both start with a bare key
  // and are continued on indented lines below it.
  let pendingKey: string | null = null
  let pendingMode: 'list' | 'folded' | null = null

  for (const line of yamlBlock.split('\n')) {
    const indented = /^\s+(.+)$/.exec(line)

    if (indented && pendingKey && pendingMode === 'list') {
      const listItem = /^-\s*(.+)$/.exec(indented[1]!.trim())
      if (listItem) {
        ;(meta[pendingKey] as string[]).push(listItem[1]!.trim())
      }
      continue
    }

    if (indented && pendingKey && pendingMode === 'folded') {
      const existing = meta[pendingKey] as string
      meta[pendingKey] = existing
        ? `${existing} ${indented[1]!.trim()}`
        : indented[1]!.trim()
      continue
    }

    const kv = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, value] = kv as unknown as [string, string, string]

    if (value === '') {
      meta[key] = []
      pendingKey = key
      pendingMode = 'list'
      continue
    }

    if (value === '>' || value === '|') {
      meta[key] = ''
      pendingKey = key
      pendingMode = 'folded'
      continue
    }

    pendingKey = null
    pendingMode = null
    meta[key] = value.replace(/^['"]|['"]$/g, '')
  }

  return { meta, body }
}

function parsePrompt(fileName: string, raw: string): Prompt {
  const { meta, body } = parseFrontMatter(raw)

  const required = ['name', 'version', 'model', 'temperature', 'description']
  for (const key of required) {
    if (meta[key] === undefined) {
      throw new Error(`Prompt "${fileName}" is missing required field "${key}"`)
    }
  }

  const systemMatch = /# System\n([\s\S]*?)(?=\n# User\n)/.exec(body)
  const userMatch = /# User\n([\s\S]*)$/.exec(body)
  if (!systemMatch || !userMatch) {
    throw new Error(
      `Prompt "${fileName}" must have both a "# System" and a "# User" section`,
    )
  }

  return {
    name: String(meta.name),
    version: String(meta.version),
    model: String(meta.model),
    temperature: Number(meta.temperature),
    description: String(meta.description),
    changelog: Array.isArray(meta.changelog)
      ? (meta.changelog as string[])
      : [],
    system: systemMatch[1]!.trim(),
    userTemplate: userMatch[1]!.trim(),
  }
}

/** Loads every `*.md` prompt file under `prompts/` into the in-memory cache. */
export async function loadPrompts(): Promise<void> {
  const files = (await readdir(PROMPTS_DIR)).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  )

  for (const file of files) {
    const raw = await readFile(path.join(PROMPTS_DIR, file), 'utf8')
    const prompt = parsePrompt(file, raw)
    cache.set(prompt.name, prompt)
  }

  loaded = true
}

function ensureLoaded(): void {
  if (!loaded) {
    throw new Error(
      'Prompts have not been loaded yet; call loadPrompts() at startup',
    )
  }
}

export function getPrompt(name: string): Prompt {
  ensureLoaded()
  const prompt = cache.get(name)
  if (!prompt) {
    throw new Error(`Unknown prompt "${name}"`)
  }
  return prompt
}

export interface RenderedPrompt {
  system: string
  user: string
  model: string
  temperature: number
}

/**
 * Renders a prompt's user template by substituting `{{key}}` placeholders
 * with `vars`. Throws if the template references a variable that isn't
 * provided, rather than sending a literal `{{key}}` to the model.
 */
export function renderPrompt(
  name: string,
  vars: Record<string, string>,
): RenderedPrompt {
  const prompt = getPrompt(name)

  const user = prompt.userTemplate.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => {
      if (!(key in vars)) {
        throw new Error(`Missing variable "${key}" for prompt "${name}"`)
      }
      return vars[key]!
    },
  )

  return {
    system: prompt.system,
    user,
    model: prompt.model,
    temperature: prompt.temperature,
  }
}
