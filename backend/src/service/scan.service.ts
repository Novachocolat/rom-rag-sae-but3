import path from 'node:path'
import type {
  ScanJobSummary,
  ScanProgress,
  ScanStatus,
} from '@repo/shared/types'
import type { FileHashes, WalkEntry } from '../storage/filesystem.storage.js'
import type { UpsertRomInput } from '../storage/rom.storage.js'
import {
  identifyRom,
  type DatLookup,
  type FinalScanStatus,
  type ScanCounters,
} from './identification.service.js'
import { normalizeTitle } from './title-normalizer.service.js'

// Pure orchestration: every I/O is injected, so the scan is testable without
// touching the filesystem, Redis or PostgreSQL.
export interface ScanDependencies {
  walk: (absoluteRoot: string) => Promise<WalkEntry[]>
  hash: (absolutePath: string) => Promise<FileHashes>
  lookup: DatLookup
  saveRom: (rom: UpsertRomInput) => Promise<unknown>
  reportProgress: ScanProgressReporter
}

export interface ScanProgressReporter {
  init(totalFiles: number): Promise<void>
  update(counters: ScanCounters): Promise<void>
  finish(
    status: FinalScanStatus,
    counters: ScanCounters,
    errorMessage: string | null,
  ): Promise<void>
}

export interface ScanOptions {
  userId: string
  absoluteRoot: string
  rootRelativePath: string // Prefix of every stored `relativePath`
  concurrency: number
  signal: AbortSignal
}

interface ScanJobRecord {
  id: string
  rootRelativePath: string
  status: ScanStatus
  totalFiles: number
  processedFiles: number
  identifiedCount: number
  unidentifiedCount: number
  errorCount: number
  startedAt: Date
  finishedAt: Date | null
  errorMessage: string | null
}

// Hand-rolled semaphore: a finishing task hands its slot straight to the next
// waiting one, so no more than `max` tasks ever run at the same time.
function createSemaphore(max: number) {
  let active = 0
  const waiting: (() => void)[] = []

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) active += 1
    else await new Promise<void>((resolve) => waiting.push(resolve))

    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}

/**
 * Counts, hashes, identifies and persists every ROM under `absoluteRoot`, at
 * most `concurrency` files at a time. A failing file only increments
 * `errorCount`; an abort skips the files not started yet.
 */
export async function runScan(
  deps: ScanDependencies,
  options: ScanOptions,
): Promise<FinalScanStatus> {
  const { walk, hash, lookup, saveRom, reportProgress } = deps
  const { userId, absoluteRoot, rootRelativePath, concurrency, signal } =
    options

  const counters: ScanCounters = {
    processedFiles: 0,
    identifiedCount: 0,
    unidentifiedCount: 0,
    errorCount: 0,
    current: null,
  }

  async function processEntry(entry: WalkEntry): Promise<void> {
    if (signal.aborted) return

    // Both sides are always POSIX ('/'), regardless of the host OS
    const relativePath = path.posix.join(rootRelativePath, entry.relativePath)
    try {
      const hashes = await hash(entry.absolutePath)
      const fileName = path.basename(entry.absolutePath)
      const identification = await identifyRom(
        {
          fileName,
          sha1FullFile: hashes.sha1,
          md5FullFile: hashes.md5,
          sha1Data: hashes.sha1Data ?? null,
          md5Data: hashes.md5Data ?? null,
          headerBytesSkipped: hashes.headerBytesSkipped,
          normalizedName: normalizeTitle(fileName).baseTitle,
        },
        lookup,
      )

      await saveRom({
        userId,
        relativePath,
        fileName,
        extension: path.extname(fileName).toLowerCase(),
        sizeBytes: BigInt(entry.sizeBytes),
        md5: hashes.md5,
        sha1: hashes.sha1,
        md5Data: hashes.md5Data ?? null,
        sha1Data: hashes.sha1Data ?? null,
        headerBytesSkipped: hashes.headerBytesSkipped,
        datEntryId: identification.entry?.id ?? null,
        identificationSource: identification.source,
        confidence: identification.confidence,
        title: identification.entry?.name ?? null,
      })

      if (identification.source === 'UNIDENTIFIED') {
        counters.unidentifiedCount += 1
      } else {
        counters.identifiedCount += 1
      }
    } catch {
      counters.errorCount += 1
    }

    counters.processedFiles += 1
    counters.current = relativePath
    await reportProgress.update({ ...counters })
  }

  try {
    const entries = await walk(absoluteRoot)
    await reportProgress.init(entries.length)

    const limit = createSemaphore(concurrency)
    await Promise.all(entries.map((entry) => limit(() => processEntry(entry))))

    const status = signal.aborted ? 'CANCELLED' : 'COMPLETED'
    await reportProgress.finish(status, { ...counters, current: null }, null)
    return status
  } catch (err) {
    await reportProgress.finish(
      'FAILED',
      { ...counters, current: null },
      err instanceof Error ? err.message : String(err),
    )
    throw err
  }
}

// Projects a ScanJob row to the progress shape, for when Redis has expired
export function toScanProgress(job: ScanJobRecord): ScanProgress {
  return {
    jobId: job.id,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    identifiedCount: job.identifiedCount,
    unidentifiedCount: job.unidentifiedCount,
    errorCount: job.errorCount,
    current: null,
    errorMessage: job.errorMessage,
  }
}

// Projects a ScanJob row to one entry of the scan history
export function toScanJobSummary(job: ScanJobRecord): ScanJobSummary {
  return {
    ...toScanProgress(job),
    rootRelativePath: job.rootRelativePath,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}
