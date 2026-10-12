import { collectionGroupingSchema } from '@repo/shared/schemas'
import type { z } from 'zod'
import { env } from '../env.js'
import type { LlmClient } from '../client/ollama/ollama.types.js'
import { ollamaLlmClient } from '../client/ollama/ollama-llm.client.js'
import { loadPrompt, renderTemplate } from '../lib/prompt-loader.js'
import { normalizeTitle } from './title-normalizer.service.js'

export const GROUPING_PROMPT = { name: 'rom-grouping', version: 'v1' }

// A bigger cluster would overflow the model's context window
export const MAX_ROMS_PER_CALL = 15

export type CollectionGrouping = z.infer<typeof collectionGroupingSchema>

export interface ClusterRom {
  id: string
  fileName: string
  platformName: string | null
}

export type GroupingDecision =
  'PROPOSED' | 'LOW_CONFIDENCE' | 'NOT_SAME_GAME' | 'REJECTED'

export interface GroupedMember {
  romId: string
  variantLabel: string | null
}

export interface GroupingOutcome {
  decision: GroupingDecision
  canonicalTitle: string
  members: GroupedMember[]
  removedRomIds: string[]
  confidence: number
  reasoning: string
  issues: string[]
  raw: string
  model: string
  durationMs: number
  promptTokens: number
  completionTokens: number
}

export interface GroupingPorts {
  llm: Pick<LlmClient, 'generateJson'>
  renderPrompt: (variables: Record<string, string>) => string
  confidenceThreshold: number
}

export class ClusterTooLargeError extends Error {
  constructor(size: number) {
    super(
      `Cluster of ${String(size)} ROMs exceeds the limit of ${String(MAX_ROMS_PER_CALL)}`,
    )
    this.name = 'ClusterTooLargeError'
  }
}

// Fills the placeholders of prompts/rom-grouping.v1.md
export function buildGroupingVariables(
  roms: ClusterRom[],
): Record<string, string> {
  const lines = roms.map((rom) => {
    const { baseTitle, region } = normalizeTitle(rom.fileName)
    return `- ${rom.id} | ${rom.fileName} | ${rom.platformName ?? 'unknown platform'} | ${baseTitle} | ${region ?? 'unknown region'}`
  })
  return { romCount: String(roms.length), roms: lines.join('\n') }
}

export function splitForPrompt<T>(
  items: T[],
  size: number = MAX_ROMS_PER_CALL,
): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

// Keeps only the ids that were actually sent: a model can invent an id, and
// accepting it would attach a ROM that does not exist to a collection
function sanitizeMembers(
  sentIds: Set<string>,
  members: CollectionGrouping['members'],
) {
  const accepted = new Map<string, string | null>()
  const unknownIds: string[] = []

  for (const member of members) {
    if (!sentIds.has(member.romId)) {
      unknownIds.push(member.romId)
      continue
    }
    if (member.belongs && !accepted.has(member.romId)) {
      accepted.set(member.romId, member.variantLabel)
    }
  }
  return { accepted, unknownIds }
}

function decide(
  grouping: CollectionGrouping,
  memberCount: number,
  threshold: number,
): GroupingDecision {
  if (!grouping.sameGame || memberCount < 2) return 'NOT_SAME_GAME'
  if (grouping.canonicalTitle.trim() === '') return 'REJECTED'
  return grouping.confidence >= threshold ? 'PROPOSED' : 'LOW_CONFIDENCE'
}

/**
 * Asks the model to confirm or correct one candidate cluster.
 * Throws ClusterTooLargeError above MAX_ROMS_PER_CALL ROMs.
 */
export async function proposeGrouping(
  roms: ClusterRom[],
  ports: GroupingPorts,
): Promise<GroupingOutcome> {
  if (roms.length > MAX_ROMS_PER_CALL) {
    throw new ClusterTooLargeError(roms.length)
  }

  const sentIds = new Set(roms.map((rom) => rom.id))
  const fresh = await ports.llm.generateJson({
    prompt: ports.renderPrompt(buildGroupingVariables(roms)),
    schema: collectionGroupingSchema,
  })

  const grouping = fresh.data
  const { accepted, unknownIds } = sanitizeMembers(sentIds, grouping.members)

  return {
    decision: decide(grouping, accepted.size, ports.confidenceThreshold),
    canonicalTitle: grouping.canonicalTitle,
    members: Array.from(accepted, ([romId, variantLabel]) => ({
      romId,
      variantLabel,
    })),
    removedRomIds: roms.map((rom) => rom.id).filter((id) => !accepted.has(id)),
    confidence: grouping.confidence,
    reasoning: grouping.reasoning,
    issues: unknownIds.map((id) => `The model invented the ROM id "${id}"`),
    raw: fresh.raw,
    model: fresh.model,
    durationMs: fresh.durationMs,
    promptTokens: fresh.promptTokens,
    completionTokens: fresh.completionTokens,
  }
}

/** Runs proposeGrouping over a cluster of any size, 15 ROMs at a time. */
export async function proposeGroupings(
  roms: ClusterRom[],
  ports: GroupingPorts,
): Promise<GroupingOutcome[]> {
  const outcomes: GroupingOutcome[] = []
  for (const chunk of splitForPrompt(roms)) {
    // A lone ROM left over by the split has nothing to be grouped with
    if (chunk.length < 2) continue
    outcomes.push(await proposeGrouping(chunk, ports))
  }
  return outcomes
}

// Builds the real ports: Ollama and the prompt file
export function buildGroupingPorts(): GroupingPorts {
  const template = loadPrompt(GROUPING_PROMPT.name, GROUPING_PROMPT.version)

  return {
    llm: ollamaLlmClient,
    renderPrompt: (variables) => renderTemplate(template, variables),
    confidenceThreshold: env.AI_CONFIDENCE_THRESHOLD,
  }
}
