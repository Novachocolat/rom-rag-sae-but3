// backend/src/service/scan.service.ts
// Pure orchestration: receives all its dependencies as parameters so it can
// be unit-tested without touching the filesystem, Redis or Postgres.

import path from 'node:path'
import {
  identifyRom,
  type DatLookup,
  type IdentificationResult,
  type RomCandidate,
  type ScanProgress,
  type ScanStatus,
} from './identification.service.js'

// --- Small hand-rolled semaphore (bounded concurrency, no external deps) ---
class Semaphore {
  private available: number
  private readonly queue: Array<() => void> = []

  constructor(max: number) {
    this.available = max
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.available -= 1
        resolve()
      })
    })
  }

  release(): void {
    this.available += 1
    const next = this.queue.shift()
    if (next) next()
  }
}

// --- Dependencies injected by the caller (routes / job-runner) -------------

export type Walk = (root: string) => Promise<string[]>
export type Hash = (filePath: string) => Promise<RomCandidate>

export interface SaveRomParams {
  userId: string
  filePath: string
  relativePath: string
  candidate: RomCandidate
  identification: IdentificationResult
}
export type SaveRom = (params: SaveRomParams) => Promise<void>

type ProgressPatch = Partial<
  Pick<
    ScanProgress,
    | 'processedFiles'
    | 'identifiedCount'
    | 'unidentifiedCount'
    | 'errorCount'
    | 'current'
  >
>

export interface ReportProgress {
  init(totalFiles: number): Promise<void>
  update(patch: ProgressPatch, options?: { force?: boolean }): Promise<void>
  finish(
    status: Extract<ScanStatus, 'DONE' | 'ERROR' | 'CANCELLED'>,
    errorMessage?: string,
  ): Promise<void>
}

export interface ScanDependencies {
  walk: Walk
  hash: Hash
  lookup: DatLookup
  saveRom: SaveRom
  reportProgress: ReportProgress
}

export interface ScanOptions {
  userId: string
  root: string
  concurrency: number
}

// --- Orchestration -----------------------------------------------------

export async function runScan(
  deps: ScanDependencies,
  options: ScanOptions,
): Promise<void> {
  const { walk, hash, lookup, saveRom, reportProgress } = deps
  const { userId, root, concurrency } = options

  //Count the files up front so progress has a known total.
  const filePaths = await walk(root)
  await reportProgress.init(filePaths.length)

  const semaphore = new Semaphore(concurrency)

  let processedFiles = 0
  let identifiedCount = 0
  let unidentifiedCount = 0
  let errorCount = 0

  async function processFile(filePath: string): Promise<void> {
    try {
      //Hash
      const candidate = await hash(filePath)

      //Identify
      const identification = await identifyRom(candidate, lookup)
      if (identification.source === 'UNIDENTIFIED') {
        unidentifiedCount += 1
      } else {
        identifiedCount += 1
      }

      //Persist
      const relativePath = path.relative(root, filePath)
      await saveRom({
        userId,
        filePath,
        relativePath,
        candidate,
        identification,
      })
    } catch {
      errorCount += 1
    } finally {
      processedFiles += 1
      //Publish progress (throttled internally by reportProgress.update)
      await reportProgress.update({
        processedFiles,
        identifiedCount,
        unidentifiedCount,
        errorCount,
        current: filePath,
      })
    }
  }

  const tasks = filePaths.map((filePath) =>
    (async () => {
      await semaphore.acquire()
      try {
        await processFile(filePath)
      } finally {
        semaphore.release()
      }
    })(),
  )

  await Promise.all(tasks)

  await reportProgress.update(
    {
      processedFiles,
      identifiedCount,
      unidentifiedCount,
      errorCount,
      current: null,
    },
    { force: true },
  )
  await reportProgress.finish('DONE')
}
