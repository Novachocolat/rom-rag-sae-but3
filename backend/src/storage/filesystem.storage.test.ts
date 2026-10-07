import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { env } from '../env.js'
import {
  detectHeaderSize,
  hashFile,
  isLibraryDirectory,
  listSubdirectories,
  readFileHead,
  resolveWithinRoot,
  walkDirectory,
} from './filesystem.storage.js'

// env.ROM_LIBRARY_ROOT is fixed to '/roms' by vitest.config.ts
describe('resolveWithinRoot', () => {
  it('resolves a plain relative path under the root', () => {
    expect(resolveWithinRoot('snes/game.sfc')).toBe(
      path.resolve(env.ROM_LIBRARY_ROOT, 'snes/game.sfc'),
    )
  })

  it.each([
    ['..', 'parent of the root'],
    ['../..', 'grandparent of the root'],
    ['../../etc/passwd', 'classic traversal to a system file'],
    ['/etc/passwd', 'absolute path outside the root'],
    ['nested/../../escape', 'traversal hidden inside a nested path'],
    ['../roms-evil/file.gba', 'sibling directory disguised as a traversal'],
  ])('rejects hostile path: %s (%s)', (hostilePath) => {
    expect(() => resolveWithinRoot(hostilePath)).toThrow()
  })

  it('keeps a URL-encoded traversal (%2e%2e) inside the root, as a literal name', () => {
    const resolved = resolveWithinRoot('%2e%2e/%2e%2e/etc/passwd')

    expect(
      resolved.startsWith(path.resolve(env.ROM_LIBRARY_ROOT) + path.sep),
    ).toBe(true)
  })
})

describe('walkDirectory', () => {
  let root: string

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('yields every matching file across a 3-level tree', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-'))
    await mkdir(path.join(root, 'a/b'), { recursive: true })
    await writeFile(path.join(root, 'top.gba'), 'top')
    await writeFile(path.join(root, 'a/mid.gba'), 'mid')
    await writeFile(path.join(root, 'a/b/deep.gba'), 'deep')

    const entries = await collect(walkDirectory(root))

    // relativePath is always POSIX, regardless of the host OS
    expect(entries.map((e) => e.relativePath).sort()).toEqual([
      'a/b/deep.gba',
      'a/mid.gba',
      'top.gba',
    ])
    expect(
      entries.find((e) => e.relativePath.endsWith('top.gba')),
    ).toMatchObject({ sizeBytes: 3 })
  })

  it('filters by extension', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-'))
    await writeFile(path.join(root, 'game.gba'), 'x')
    await writeFile(path.join(root, 'readme.txt'), 'x')

    const entries = await collect(walkDirectory(root, { extensions: ['.gba'] }))

    expect(entries).toHaveLength(1)
    expect(entries[0]?.relativePath).toBe('game.gba')
  })

  it('respects maxDepth', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-'))
    await mkdir(path.join(root, 'a/b'), { recursive: true })
    await writeFile(path.join(root, 'a/mid.gba'), 'x')
    await writeFile(path.join(root, 'a/b/deep.gba'), 'x')

    const entries = await collect(walkDirectory(root, { maxDepth: 1 }))

    expect(entries.map((e) => e.relativePath)).toEqual(['a/mid.gba'])
  })

  it('ignores hidden files, node_modules and .git', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-'))
    await mkdir(path.join(root, 'node_modules'), { recursive: true })
    await mkdir(path.join(root, '.git'), { recursive: true })
    await writeFile(path.join(root, '.hidden.gba'), 'x')
    await writeFile(path.join(root, 'node_modules/dep.gba'), 'x')
    await writeFile(path.join(root, '.git/config.gba'), 'x')
    await writeFile(path.join(root, 'visible.gba'), 'x')

    const entries = await collect(walkDirectory(root))

    expect(entries.map((e) => e.relativePath)).toEqual(['visible.gba'])
  })

  it('ignores symlinks instead of following them', async (ctx) => {
    root = await mkdtemp(path.join(tmpdir(), 'walk-'))
    await writeFile(path.join(root, 'real.gba'), 'x')
    try {
      await symlink(path.join(root, 'real.gba'), path.join(root, 'link.gba'))
    } catch (error) {
      // Creating symlinks requires Developer Mode or admin rights on Windows
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        ctx.skip()
        return
      }
      throw error
    }

    const entries = await collect(walkDirectory(root))

    expect(entries.map((e) => e.relativePath)).toEqual(['real.gba'])
  })
})

describe('detectHeaderSize', () => {
  it('detects the iNES header from its magic bytes', () => {
    const header = Buffer.from([0x4e, 0x45, 0x53, 0x1a, 0, 0])
    expect(detectHeaderSize(header, 16 + 32768)).toBe(16)
  })

  it('detects a SNES copier header from the size modulo 1024', () => {
    const header = Buffer.from([0x40, 0x00, 0x31, 0x00])
    expect(detectHeaderSize(header, 524800)).toBe(512)
  })

  it('returns 0 when nothing matches', () => {
    const header = Buffer.from([0, 0, 0, 0])
    expect(detectHeaderSize(header, 32768)).toBe(0)
  })
})

describe('hashFile', () => {
  // Fixture from the sprint brief: 512-byte SMC copier header + 524288-byte SNES ROM.
  const fixture = path.resolve(
    import.meta.dirname,
    '../../../dataset/roms/snes/Super_Mario_Kart.sfc',
  )

  it('matches known full-file and data-only digests', async () => {
    const result = await hashFile(fixture)

    expect(result).toEqual({
      md5: '82d28b41e06c7a7596f74c151ded59c8',
      sha1: 'fe8ca691fc951eff2dd7830fcd1e2b11ac9d6419',
      md5Data: 'f9fe266e91632e68b558d6b43393eaba',
      sha1Data: '27d9b4f30d39af75075691344b7bdeedbd32ac19',
      headerBytesSkipped: 512,
    })
  })

  it('rejects a file that does not exist instead of hanging', async () => {
    await expect(
      hashFile(path.join(tmpdir(), 'missing-rom-file.gba')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('hashes an empty (corrupted) file without any data-only digest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'hash-'))
    const empty = path.join(root, 'empty.nes')
    await writeFile(empty, '')

    try {
      await expect(hashFile(empty)).resolves.toEqual({
        md5: 'd41d8cd98f00b204e9800998ecf8427e',
        sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
        md5Data: undefined,
        sha1Data: undefined,
        headerBytesSkipped: 0,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('readFileHead', () => {
  it('returns at most `length` bytes, fewer for a shorter file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'head-'))
    const file = path.join(root, 'short.gb')
    await writeFile(file, Buffer.from([1, 2, 3]))

    try {
      await expect(readFileHead(file, 2)).resolves.toEqual(Buffer.from([1, 2]))
      await expect(readFileHead(file)).resolves.toEqual(Buffer.from([1, 2, 3]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('listSubdirectories', () => {
  it('lists immediate subdirectories only, sorted, excluding files and dotfiles', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'library-'))
    await mkdir(path.join(root, 'zeta'))
    await mkdir(path.join(root, 'alpha'))
    await mkdir(path.join(root, '.hidden'))
    await writeFile(path.join(root, 'not-a-dir.gba'), 'x')

    const originalRoot = env.ROM_LIBRARY_ROOT
    env.ROM_LIBRARY_ROOT = root
    try {
      await expect(listSubdirectories('.')).resolves.toEqual(['alpha', 'zeta'])
    } finally {
      env.ROM_LIBRARY_ROOT = originalRoot
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('isLibraryDirectory', () => {
  it('accepts an existing directory and rejects a file or a missing path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'library-'))
    await mkdir(path.join(root, 'snes'))
    await writeFile(path.join(root, 'game.gba'), 'x')

    const originalRoot = env.ROM_LIBRARY_ROOT
    env.ROM_LIBRARY_ROOT = root
    try {
      await expect(isLibraryDirectory('')).resolves.toBe(true)
      await expect(isLibraryDirectory('snes')).resolves.toBe(true)
      await expect(isLibraryDirectory('game.gba')).resolves.toBe(false)
      await expect(isLibraryDirectory('missing')).resolves.toBe(false)
    } finally {
      env.ROM_LIBRARY_ROOT = originalRoot
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a hostile path before touching the disk', async () => {
    await expect(isLibraryDirectory('../etc')).rejects.toThrow()
  })

  it('rejects a symlinked directory that leads outside the root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'library-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
    // A junction needs no admin rights on Windows; the type is ignored elsewhere
    await symlink(outside, path.join(root, 'escape'), 'junction')

    const originalRoot = env.ROM_LIBRARY_ROOT
    env.ROM_LIBRARY_ROOT = root
    try {
      await expect(isLibraryDirectory('escape')).resolves.toBe(false)
    } finally {
      env.ROM_LIBRARY_ROOT = originalRoot
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}
