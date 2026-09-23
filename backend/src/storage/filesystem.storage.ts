import { createHash, type Hash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../env.js'

// The only file in the backend allowed to touch node:fs.

export interface WalkOptions {
  extensions?: string[]
  maxDepth?: number
}

export interface WalkEntry {
  absolutePath: string
  relativePath: string
  sizeBytes: number
}

export interface FileHashes {
  md5: string
  sha1: string
  md5Data?: string
  sha1Data?: string
  headerBytesSkipped: number
}

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git'])

// Dedicated type so callers (e.g. routes) can distinguish a hostile path
// from an unrelated I/O failure and answer 400 instead of 500.
export class PathTraversalError extends Error {
  constructor(relativePath: string) {
    super(`Path escapes ROM_LIBRARY_ROOT: ${relativePath}`)
    this.name = 'PathTraversalError'
  }
}

/**
 * Resolves a user-supplied relative path against ROM_LIBRARY_ROOT and
 * rejects anything that escapes it. This is the directory-traversal guard
 * (`../../etc/passwd`) every other function in this module goes through it.
 */
export function resolveWithinRoot(relativePath: string): string {
  const root = path.resolve(env.ROM_LIBRARY_ROOT)
  const resolved = path.resolve(root, relativePath)

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PathTraversalError(relativePath)
  }

  return resolved
}

/**
 * Recursively walks `absRoot`, yielding one entry per matching file.
 * A generator, not an array: scanning 10,000 files should stream, not allocate.
 */
export async function* walkDirectory(
  absRoot: string,
  { extensions, maxDepth = Infinity }: WalkOptions = {},
): AsyncGenerator<WalkEntry> {
  yield* walk(absRoot, 0)

  async function* walk(
    currentDir: string,
    depth: number,
  ): AsyncGenerator<WalkEntry> {
    const dirents = await readdir(currentDir, { withFileTypes: true })

    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue

      const absolutePath = path.join(currentDir, dirent.name)
      // lstat, not stat: never follow symlinks, they could loop back on themselves
      const stats = await lstat(absolutePath)

      if (stats.isSymbolicLink()) continue

      if (stats.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(dirent.name)) continue
        if (depth + 1 > maxDepth) continue
        yield* walk(absolutePath, depth + 1)
        continue
      }

      if (!stats.isFile()) continue
      if (extensions && !extensions.includes(normalizeExtension(dirent.name))) {
        continue
      }

      yield {
        absolutePath,
        relativePath: path.relative(absRoot, absolutePath),
        sizeBytes: stats.size,
      }
    }
  }
}

function normalizeExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase()
}

/**
 * Detects a known header that must be skipped for the "data-only" hash to
 * match No-Intro/Redump catalogs.
 */
export function detectHeaderSize(
  firstBytes: Buffer,
  sizeBytes: number,
): number {
  const isInesHeader =
    firstBytes.length >= 4 &&
    firstBytes[0] === 0x4e && // N
    firstBytes[1] === 0x45 && // E
    firstBytes[2] === 0x53 && // S
    firstBytes[3] === 0x1a
  if (isInesHeader) return 16 // NES (iNES header)

  if (sizeBytes % 1024 === 512) return 512 // SNES copier header (SMC)

  return 0
}

/**
 * Streams the file once, feeding a single read into MD5 + SHA-1 (full file),
 * plus MD5 + SHA-1 over the data only when a copier/header is detected
 * so a multi-GB ISO is never loaded into memory.
 */
export function hashFile(absolutePath: string): Promise<FileHashes> {
  return new Promise((resolve, reject) => {
    stat(absolutePath)
      .then((stats) => {
        const md5Full = createHash('md5')
        const sha1Full = createHash('sha1')
        let md5Data: Hash | undefined
        let sha1Data: Hash | undefined
        let headerBytesSkipped = 0
        let bytesSeen = 0

        const stream = createReadStream(absolutePath)

        stream.on('data', (raw) => {
          const chunk = raw as Buffer
          const offsetBeforeChunk = bytesSeen
          bytesSeen += chunk.length

          md5Full.update(chunk)
          sha1Full.update(chunk)

          if (offsetBeforeChunk === 0) {
            headerBytesSkipped = detectHeaderSize(chunk, stats.size)
            if (headerBytesSkipped > 0) {
              md5Data = createHash('md5')
              sha1Data = createHash('sha1')
            }
          }

          if (headerBytesSkipped > 0 && md5Data && sha1Data) {
            const dataStart = Math.max(
              0,
              headerBytesSkipped - offsetBeforeChunk,
            )
            if (dataStart < chunk.length) {
              const dataChunk = chunk.subarray(dataStart)
              md5Data.update(dataChunk)
              sha1Data.update(dataChunk)
            }
          }
        })

        stream.on('end', () => {
          resolve({
            md5: md5Full.digest('hex'),
            sha1: sha1Full.digest('hex'),
            md5Data: md5Data?.digest('hex'),
            sha1Data: sha1Data?.digest('hex'),
            headerBytesSkipped,
          })
        })

        stream.on('error', reject)
      })
      .catch(reject)
  })
}

/** Lists the immediate subdirectories of `relativePath`, for the frontend's folder browser. */
export async function listSubdirectories(
  relativePath: string,
): Promise<string[]> {
  const absolutePath = resolveWithinRoot(relativePath)
  const dirents = await readdir(absolutePath, { withFileTypes: true })

  const subdirectories: string[] = []
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.') || IGNORED_DIRECTORIES.has(dirent.name)) {
      continue
    }

    // lstat, not stat: a symlinked directory is not a real subdirectory here
    const stats = await lstat(path.join(absolutePath, dirent.name))
    if (stats.isDirectory()) subdirectories.push(dirent.name)
  }

  return subdirectories.sort()
}
