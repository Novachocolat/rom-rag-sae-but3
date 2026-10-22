import { collectionGroupingSchema } from '@repo/shared/schemas'
import type { CollectionGrouping } from '@repo/shared/types'
import { env } from '../env.js'
import type { LlmClient } from '../client/ollama/ollama.types.js'
import { ollamaLlmClient } from '../client/ollama/ollama-llm.client.js'
import { loadPrompts, renderPrompt } from './prompt-loader.service.js'
import { normalizeTitle } from './title-normalizer.service.js'

// Name and version of the prompt file used for grouping (`prompts/<name>.<version>.md`)
export const GROUPING_PROMPT = { name: 'grouping', version: 'v1' }

// A bigger cluster would overflow the model's context window
export const MAX_ROMS_PER_CALL = 15

// What the model is told about one ROM of a cluster
export interface ClusterRom {
  id: string
  fileName: string
  platformName: string | null
}

/**
 * Verdict on a cluster.
 * PROPOSED: same game and confident enough.
 * LOW_CONFIDENCE: same game, but below the confidence threshold.
 * NOT_SAME_GAME: the model refused, or fewer than two ROMs remain.
 * REJECTED: the model gave no canonical title.
 */
export type GroupingDecision =
  'PROPOSED' | 'LOW_CONFIDENCE' | 'NOT_SAME_GAME' | 'REJECTED'

// A type alias, not an interface: it is stored as JSON in the proposal payload
/** A ROM the model kept, with the label telling it apart (region, revision), if any. */
export type GroupedMember = {
  romId: string
  variantLabel: string | null
}

/**
 * Result of one model call: the decision, the members kept, the ROMs removed
 * from the cluster, the ids the model invented (`issues`) and the inference
 * metrics.
 */
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
  tokensPerSecond: number
  promptTokens: number
  completionTokens: number
}

/** Dependencies of proposeGrouping, injected so tests can replace the model and the prompt. */
export interface GroupingPorts {
  llm: Pick<LlmClient, 'generateJson'>
  renderPrompt: (variables: Record<string, string>) => {
    system: string
    user: string
  }
  confidenceThreshold: number
}

/** Thrown when a cluster holds more than MAX_ROMS_PER_CALL ROMs. */
export class ClusterTooLargeError extends Error {
  constructor(size: number) {
    super(
      `Cluster of ${String(size)} ROMs exceeds the limit of ${String(MAX_ROMS_PER_CALL)}`,
    )
    this.name = 'ClusterTooLargeError'
  }
}

/**
 * Fills the placeholders of `prompts/grouping.v1.md`.
 * @returns `romCount`, and `roms`: one
 * "- id | file name | platform | base title | region" line per ROM
 */
export function buildGroupingVariables(
  roms: ClusterRom[],
): Record<string, string> {
  const lines = roms.map((rom) => {
    const { baseTitle, region } = normalizeTitle(rom.fileName)
    return `- ${rom.id} | ${rom.fileName} | ${rom.platformName ?? 'unknown platform'} | ${baseTitle} | ${region ?? 'unknown region'}`
  })
  return { romCount: String(roms.length), roms: lines.join('\n') }
}

/**
 * Splits a list into consecutive chunks.
 * @param size - Maximum chunk length
 */
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

/**
 * Keeps only the ids that were actually sent: a model can invent an id, and
 * accepting it would attach a ROM that does not exist to a collection.
 * @returns `accepted`: romId -> variantLabel for the known ROMs marked
 * `belongs` (the first verdict wins); `unknownIds`: the invented ids
 */
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

/**
 * Turns the model's answer into a decision.
 * @param memberCount - Number of ROMs kept once the answer is sanitized
 * @param threshold - Minimum confidence for PROPOSED
 */
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
 * A ROM the model does not mention, or marks as not belonging, ends up in
 * `removedRomIds`. An invented id is dropped and reported in `issues`.
 * @throws {ClusterTooLargeError} Above MAX_ROMS_PER_CALL ROMs
 */
export async function proposeGrouping(
  roms: ClusterRom[],
  ports: GroupingPorts,
): Promise<GroupingOutcome> {
  if (roms.length > MAX_ROMS_PER_CALL) {
    throw new ClusterTooLargeError(roms.length)
  }

  const sentIds = new Set(roms.map((rom) => rom.id))
  const prompt = ports.renderPrompt(buildGroupingVariables(roms))
  const fresh = await ports.llm.generateJson({
    prompt: prompt.user,
    system: prompt.system,
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
    tokensPerSecond: fresh.tokensPerSecond,
    promptTokens: fresh.promptTokens,
    completionTokens: fresh.completionTokens,
  }
}

/**
 * Runs proposeGrouping over a cluster of any size, MAX_ROMS_PER_CALL ROMs at a
 * time, one call after the other. The ROMs are sorted by base title first, so
 * the variants of one game stay in the same chunk. A chunk of a single ROM has
 * nothing to be grouped with and is skipped.
 * @returns One outcome per chunk sent to the model
 */
export async function proposeGroupings(
  roms: ClusterRom[],
  ports: GroupingPorts,
): Promise<GroupingOutcome[]> {
  const byTitle = roms
    .map((rom) => ({ rom, baseTitle: normalizeTitle(rom.fileName).baseTitle }))
    .sort((a, b) => a.baseTitle.localeCompare(b.baseTitle))
    .map(({ rom }) => rom)

  const outcomes: GroupingOutcome[] = []
  for (const chunk of splitForPrompt(byTitle)) {
    if (chunk.length < 2) continue
    outcomes.push(await proposeGrouping(chunk, ports))
  }
  return outcomes
}

/**
 * Builds the real ports: the Ollama client, the versioned prompt file and the
 * configured confidence threshold. The prompt files are (re)read here, so a
 * detection never runs on prompts that were not loaded.
 */
export async function buildGroupingPorts(): Promise<GroupingPorts> {
  await loadPrompts()

  return {
    llm: ollamaLlmClient,
    renderPrompt: (variables) => renderPrompt(GROUPING_PROMPT.name, variables),
    confidenceThreshold: env.AI_CONFIDENCE_THRESHOLD,
  }
}
