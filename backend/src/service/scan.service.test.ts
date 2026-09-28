import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WalkEntry } from '../storage/filesystem.storage.js'
import {
  runScan,
  toScanJobSummary,
  toScanProgress,
  type ScanDependencies,
  type ScanOptions,
} from './scan.service.js'

function makeEntry(relativePath: string): WalkEntry {
  return {
    absolutePath: path.join('/roms/nes', relativePath),
    relativePath,
    sizeBytes: 1024,
  }
}

function makeDeps(
  entries: WalkEntry[],
  overrides: Partial<ScanDependencies> = {},
): ScanDependencies {
  return {
    walk: vi.fn().mockResolvedValue(entries),
    hash: vi.fn().mockResolvedValue({
      md5: 'a'.repeat(32),
      sha1: 'b'.repeat(40),
      headerBytesSkipped: 0,
    }),
    lookup: {
      findBySha1Full: vi.fn().mockResolvedValue(null),
      findByMd5Full: vi.fn().mockResolvedValue(null),
      findBySha1Data: vi.fn().mockResolvedValue(null),
      findByMd5Data: vi.fn().mockResolvedValue(null),
      findByNormalizedName: vi.fn().mockResolvedValue(null),
    },
    saveRom: vi.fn().mockResolvedValue(undefined),
    reportProgress: {
      init: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

function makeOptions(overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    userId: 'user-1',
    absoluteRoot: '/roms/nes',
    rootRelativePath: 'nes',
    concurrency: 2,
    signal: new AbortController().signal,
    ...overrides,
  }
}

// Tests for the scan orchestration, with every dependency mocked: no
// filesystem, Redis or PostgreSQL involved.
describe('runScan', () => {
  it('counts the files, then saves each one and completes', async () => {
    const deps = makeDeps([makeEntry('a.nes'), makeEntry('b.nes')])

    const status = await runScan(deps, makeOptions())

    expect(status).toBe('COMPLETED')
    expect(deps.walk).toHaveBeenCalledWith('/roms/nes')
    expect(deps.reportProgress.init).toHaveBeenCalledWith(2)
    expect(deps.saveRom).toHaveBeenCalledTimes(2)
    expect(deps.reportProgress.finish).toHaveBeenCalledWith(
      'COMPLETED',
      {
        processedFiles: 2,
        identifiedCount: 0,
        unidentifiedCount: 2,
        errorCount: 0,
        current: null,
      },
      null,
    )
  })

  it('stores paths relative to the library root, with the DAT entry it matched', async () => {
    const deps = makeDeps([makeEntry('Game (Europe).nes')])
    vi.mocked(deps.lookup.findBySha1Full).mockResolvedValue({
      id: 'dat-entry-1',
      name: 'Game (Europe)',
      sha1: 'b'.repeat(40),
      md5: 'a'.repeat(32),
    })

    await runScan(deps, makeOptions())

    expect(deps.saveRom).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        relativePath: path.join('nes', 'Game (Europe).nes'),
        fileName: 'Game (Europe).nes',
        extension: '.nes',
        sizeBytes: 1024n,
        datEntryId: 'dat-entry-1',
        identificationSource: 'DAT_SHA1',
        title: 'Game (Europe)',
      }),
    )
  })

  it('counts a failing file as an error without stopping the scan', async () => {
    const deps = makeDeps([makeEntry('good.nes'), makeEntry('broken.nes')])
    vi.mocked(deps.hash).mockImplementation((absolutePath: string) =>
      absolutePath.includes('broken')
        ? Promise.reject(new Error('EACCES'))
        : Promise.resolve({ md5: 'a', sha1: 'b', headerBytesSkipped: 0 }),
    )

    const status = await runScan(deps, makeOptions())

    expect(status).toBe('COMPLETED')
    expect(deps.saveRom).toHaveBeenCalledTimes(1)
    expect(deps.reportProgress.finish).toHaveBeenCalledWith(
      'COMPLETED',
      expect.objectContaining({ processedFiles: 2, errorCount: 1 }),
      null,
    )
  })

  it('never hashes more than `concurrency` files at the same time', async () => {
    let active = 0
    let maxActive = 0
    const entries = Array.from({ length: 6 }, (_, i) => makeEntry(`${i}.nes`))
    const deps = makeDeps(entries, {
      hash: vi.fn(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { md5: 'a', sha1: 'b', headerBytesSkipped: 0 }
      }),
    })

    await runScan(deps, makeOptions({ concurrency: 2 }))

    expect(maxActive).toBe(2)
    expect(deps.saveRom).toHaveBeenCalledTimes(6)
  })

  it('skips the remaining files and ends CANCELLED once aborted', async () => {
    const controller = new AbortController()
    const entries = Array.from({ length: 4 }, (_, i) => makeEntry(`${i}.nes`))
    const deps = makeDeps(entries, {
      saveRom: vi.fn(() => {
        controller.abort()
        return Promise.resolve()
      }),
    })

    const status = await runScan(
      deps,
      makeOptions({ concurrency: 1, signal: controller.signal }),
    )

    expect(status).toBe('CANCELLED')
    expect(deps.saveRom).toHaveBeenCalledTimes(1)
    expect(deps.reportProgress.finish).toHaveBeenCalledWith(
      'CANCELLED',
      expect.objectContaining({ processedFiles: 1 }),
      null,
    )
  })

  it('ends FAILED and rethrows when the directory cannot be walked', async () => {
    const deps = makeDeps([], {
      walk: vi.fn().mockRejectedValue(new Error('ENOENT')),
    })

    await expect(runScan(deps, makeOptions())).rejects.toThrow('ENOENT')
    expect(deps.reportProgress.finish).toHaveBeenCalledWith(
      'FAILED',
      expect.objectContaining({ processedFiles: 0 }),
      'ENOENT',
    )
  })
})

describe('ScanJob projections', () => {
  const job = {
    id: 'job-1',
    rootRelativePath: 'nes',
    status: 'COMPLETED' as const,
    totalFiles: 10,
    processedFiles: 10,
    identifiedCount: 8,
    unidentifiedCount: 1,
    errorCount: 1,
    startedAt: new Date('2026-09-27T10:00:00Z'),
    finishedAt: new Date('2026-09-27T10:01:00Z'),
    errorMessage: null,
  }

  it('toScanProgress keeps the counters and has no current file', () => {
    expect(toScanProgress(job)).toEqual({
      jobId: 'job-1',
      status: 'COMPLETED',
      totalFiles: 10,
      processedFiles: 10,
      identifiedCount: 8,
      unidentifiedCount: 1,
      errorCount: 1,
      current: null,
      errorMessage: null,
    })
  })

  it('toScanJobSummary adds the root and the dates', () => {
    expect(toScanJobSummary(job)).toMatchObject({
      jobId: 'job-1',
      rootRelativePath: 'nes',
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    })
  })
})
