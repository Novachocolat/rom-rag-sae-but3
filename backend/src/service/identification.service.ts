// backend/src/service/identification.service.ts
import { Redis } from 'ioredis'

export type IdentificationSource =
  | 'DAT_SHA1'
  | 'DAT_MD5'
  | 'DAT_SHA1_DATA'
  | 'DAT_MD5_DATA'
  | 'DAT_NAME'
  | 'UNIDENTIFIED'

export interface RomCandidate {
  fileName: string
  sha1FullFile: string
  md5FullFile: string
  sha1Data?: string | null
  md5Data?: string | null
  headerBytesSkipped: number
  normalizedName?: string | null
}

export interface DatEntry {
  name: string
  sha1: string
  md5: string
  [key: string]: unknown
}
export interface DatLookup {
  findBySha1Full(sha1: string): Promise<DatEntry | null>
  findByMd5Full(md5: string): Promise<DatEntry | null>
  findBySha1Data(sha1: string): Promise<DatEntry | null>
  findByMd5Data(md5: string): Promise<DatEntry | null>
  findByNormalizedName(name: string): Promise<DatEntry | null>
}

export interface IdentificationResult {
  source: IdentificationSource
  confidence: number
  entry: DatEntry | null
  candidate: RomCandidate
}

const CONFIDENCE: Record<IdentificationSource, number> = {
  DAT_SHA1: 1.0,
  DAT_MD5: 0.99,
  DAT_SHA1_DATA: 0.97,
  DAT_MD5_DATA: 0.96,
  DAT_NAME: 0.8,
  UNIDENTIFIED: 0,
}

// Identification of ROM candidate in a DAT ---
export async function identifyRom(
  candidate: RomCandidate,
  datLookup: DatLookup,
): Promise<IdentificationResult> {
  const bySha1 = await datLookup.findBySha1Full(candidate.sha1FullFile)
  if (bySha1) return buildResult('DAT_SHA1', bySha1, candidate)

  const byMd5 = await datLookup.findByMd5Full(candidate.md5FullFile)
  if (byMd5) return buildResult('DAT_MD5', byMd5, candidate)

  if (candidate.headerBytesSkipped > 0) {
    if (candidate.sha1Data) {
      const bySha1Data = await datLookup.findBySha1Data(candidate.sha1Data)
      if (bySha1Data) return buildResult('DAT_SHA1_DATA', bySha1Data, candidate)
    }

    if (candidate.md5Data) {
      const byMd5Data = await datLookup.findByMd5Data(candidate.md5Data)
      if (byMd5Data) return buildResult('DAT_MD5_DATA', byMd5Data, candidate)
    }
  }

  if (candidate.normalizedName) {
    const byName = await datLookup.findByNormalizedName(
      candidate.normalizedName,
    )
    if (byName) return buildResult('DAT_NAME', byName, candidate)
  }

  return buildResult('UNIDENTIFIED', null, candidate)
}

function buildResult(
  source: IdentificationSource,
  entry: DatEntry | null,
  candidate: RomCandidate,
): IdentificationResult {
  return { source, confidence: CONFIDENCE[source], entry, candidate }
}

// Key "scan:<jobId>", JSON value, EX of a few hours.
// updateProgress is throttled: we don't write to Redis on every single file,
// but every N files OR every 500ms (otherwise the scan becomes slower than
// the hashing itself).

export type ScanStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR' | 'CANCELLED'

export interface ScanProgress {
  jobId: string
  status: ScanStatus
  totalFiles: number
  processedFiles: number
  identifiedCount: number
  unidentifiedCount: number
  errorCount: number
  current: string | null
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  errorMessage: string | null
}

const SCAN_PROGRESS_TTL_SECONDS = 6 * 60 * 60
const SCAN_PROGRESS_THROTTLE_MS = 500
const SCAN_PROGRESS_THROTTLE_EVERY_N_FILES = 25

function scanProgressKey(jobId: string): string {
  return `scan:${jobId}`
}

// Throttle state is kept in memory, not in Redis, because it's only relevant
const scanProgressThrottleState = new Map<
  string,
  { at: number; count: number }
>()

function parseScanProgress(raw: string): ScanProgress {
  return JSON.parse(raw) as ScanProgress
}

export async function initProgress(
  redis: Redis,
  jobId: string,
  totalFiles: number,
): Promise<ScanProgress> {
  const now = new Date().toISOString()
  const progress: ScanProgress = {
    jobId,
    status: 'RUNNING',
    totalFiles,
    processedFiles: 0,
    identifiedCount: 0,
    unidentifiedCount: 0,
    errorCount: 0,
    current: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    errorMessage: null,
  }
  scanProgressThrottleState.set(jobId, { at: Date.now(), count: 0 })
  await redis.set(
    scanProgressKey(jobId),
    JSON.stringify(progress),
    'EX',
    SCAN_PROGRESS_TTL_SECONDS,
  )
  return progress
}

export async function updateProgress(
  redis: Redis,
  jobId: string,
  patch: Partial<
    Pick<
      ScanProgress,
      | 'processedFiles'
      | 'identifiedCount'
      | 'unidentifiedCount'
      | 'errorCount'
      | 'current'
    >
  >,
  options: { force?: boolean } = {},
): Promise<void> {
  const state = scanProgressThrottleState.get(jobId) ?? { at: 0, count: 0 }
  state.count += 1

  const now = Date.now()
  const elapsed = now - state.at
  const shouldWrite =
    options.force ||
    elapsed >= SCAN_PROGRESS_THROTTLE_MS ||
    state.count >= SCAN_PROGRESS_THROTTLE_EVERY_N_FILES

  if (!shouldWrite) {
    scanProgressThrottleState.set(jobId, state)
    return
  }

  const raw = await redis.get(scanProgressKey(jobId))
  if (!raw) return // job expired or was cancelled in the meantime

  const current = parseScanProgress(raw)
  const updated: ScanProgress = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  await redis.set(
    scanProgressKey(jobId),
    JSON.stringify(updated),
    'EX',
    SCAN_PROGRESS_TTL_SECONDS,
  )
  scanProgressThrottleState.set(jobId, { at: now, count: 0 })
}

export async function getProgress(
  redis: Redis,
  jobId: string,
): Promise<ScanProgress | null> {
  const raw = await redis.get(scanProgressKey(jobId))
  return raw ? parseScanProgress(raw) : null
}

export async function finishProgress(
  redis: Redis,
  jobId: string,
  status: Extract<ScanStatus, 'DONE' | 'ERROR' | 'CANCELLED'>,
  errorMessage?: string,
): Promise<ScanProgress | null> {
  const raw = await redis.get(scanProgressKey(jobId))
  if (!raw) return null

  const current = parseScanProgress(raw)
  const updated: ScanProgress = {
    ...current,
    status,
    current: null,
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errorMessage: errorMessage ?? null,
  }

  await redis.set(
    scanProgressKey(jobId),
    JSON.stringify(updated),
    'EX',
    SCAN_PROGRESS_TTL_SECONDS,
  )
  scanProgressThrottleState.delete(jobId)
  return updated
}
