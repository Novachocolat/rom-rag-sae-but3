import { describe, expect, it, vi } from 'vitest'
import { runScan, type ScanDependencies } from './scan.service.js'
import type { RomCandidate } from './identification.service.js'

function makeCandidate(fileName: string): RomCandidate {
  return {
    fileName,
    sha1FullFile: 'a'.repeat(40),
    md5FullFile: 'b'.repeat(32),
    headerBytesSkipped: 0,
  }
}

describe('runScan', () => {
  it('processes every file found by walk and reports progress', async () => {
    const files = ['/roms/a.nes', '/roms/b.nes']

    const deps: ScanDependencies = {
      walk: vi.fn().mockResolvedValue(files),
      hash: vi
        .fn()
        .mockImplementation(async (filePath: string) =>
          makeCandidate(filePath),
        ),
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
    }

    await runScan(deps, { userId: 'user-1', root: '/roms', concurrency: 2 })

    expect(deps.walk).toHaveBeenCalledWith('/roms')
    expect(deps.reportProgress.init).toHaveBeenCalledWith(2)
    expect(deps.hash).toHaveBeenCalledTimes(2)
    expect(deps.saveRom).toHaveBeenCalledTimes(2)
    expect(deps.reportProgress.finish).toHaveBeenCalledWith('DONE')
  })

  it('continues the scan and counts errors when a file fails to hash', async () => {
    const files = ['/roms/good.nes', '/roms/broken.nes']

    const deps: ScanDependencies = {
      walk: vi.fn().mockResolvedValue(files),
      hash: vi.fn().mockImplementation(async (filePath: string) => {
        if (filePath.includes('broken')) throw new Error('read error')
        return makeCandidate(filePath)
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
    }

    await runScan(deps, { userId: 'user-1', root: '/roms', concurrency: 2 })

    expect(deps.saveRom).toHaveBeenCalledTimes(1)
    expect(deps.reportProgress.finish).toHaveBeenCalledWith('DONE')
  })

  it('never runs more than `concurrency` files hashed at the same time', async () => {
    let active = 0
    let maxActive = 0

    const files = Array.from({ length: 6 }, (_, i) => `/roms/f${i}.nes`)

    const deps: ScanDependencies = {
      walk: vi.fn().mockResolvedValue(files),
      hash: vi.fn().mockImplementation(async (filePath: string) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active -= 1
        return makeCandidate(filePath)
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
    }

    await runScan(deps, { userId: 'user-1', root: '/roms', concurrency: 2 })

    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
