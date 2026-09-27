import type { ScanProgress, ScanStatus } from '@repo/shared/types'
import {
  getScanProgress,
  saveScanProgress,
  type StoredScanProgress,
} from '../storage/scan-progress.storage.js'

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
  id?: string
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

export type ScanCounters = Pick<
  ScanProgress,
  | 'processedFiles'
  | 'identifiedCount'
  | 'unidentifiedCount'
  | 'errorCount'
  | 'current'
>

export type FinalScanStatus = Extract<
  ScanStatus,
  'COMPLETED' | 'FAILED' | 'CANCELLED'
>

// Writing to Redis on every file would make the scan slower than the hashing
// itself: updates are flushed every N files or every 500 ms, whichever first.
const PROGRESS_FLUSH_EVERY_FILES = 25
const PROGRESS_FLUSH_INTERVAL_MS = 500

interface ProgressThrottle {
  progress: StoredScanProgress
  pendingUpdates: number
  lastFlushAt: number
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

const progressThrottles = new Map<string, ProgressThrottle>()

// Starts tracking a scan in Redis as RUNNING, every counter at zero
export async function initProgress(
  jobId: string,
  userId: string,
  totalFiles: number,
): Promise<void> {
  const progress: StoredScanProgress = {
    jobId,
    userId,
    status: 'RUNNING',
    totalFiles,
    processedFiles: 0,
    identifiedCount: 0,
    unidentifiedCount: 0,
    errorCount: 0,
    current: null,
    errorMessage: null,
  }

  progressThrottles.set(jobId, {
    progress,
    pendingUpdates: 0,
    lastFlushAt: Date.now(),
  })
  await saveScanProgress(progress)
}

/**
 * Merges `counters` into the scan's progress in memory; only writes it to Redis
 * when the throttle allows it (`finishProgress` always writes the last state)
 */
export async function updateProgress(
  jobId: string,
  counters: ScanCounters,
): Promise<void> {
  const throttle = progressThrottles.get(jobId)
  if (!throttle) return

  throttle.progress = { ...throttle.progress, ...counters }
  throttle.pendingUpdates += 1

  const now = Date.now()
  const shouldFlush =
    throttle.pendingUpdates >= PROGRESS_FLUSH_EVERY_FILES ||
    now - throttle.lastFlushAt >= PROGRESS_FLUSH_INTERVAL_MS
  if (!shouldFlush) return

  throttle.pendingUpdates = 0
  throttle.lastFlushAt = now
  await saveScanProgress(throttle.progress)
}

// Reads a scan's progress from Redis, null once expired or never started
export function getProgress(jobId: string): Promise<StoredScanProgress | null> {
  return getScanProgress(jobId)
}

// Writes the final status to Redis and stops tracking the scan in memory
export async function finishProgress(
  jobId: string,
  status: FinalScanStatus,
  errorMessage: string | null = null,
): Promise<void> {
  const throttle = progressThrottles.get(jobId)
  if (!throttle) return

  progressThrottles.delete(jobId)
  await saveScanProgress({
    ...throttle.progress,
    status,
    current: null,
    errorMessage,
  })
}
