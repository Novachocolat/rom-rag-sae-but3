import path from 'node:path'

export interface PlatformDefinition {
  id: string
  extensions: string[]
}

// Slugs seeded by prisma/seed.ts: the stable key of each supported platform
export type PlatformSlug =
  | 'nintendo-nes'
  | 'nintendo-snes'
  | 'nintendo-game-boy'
  | 'nintendo-game-boy-color'
  | 'nintendo-game-boy-advance'
  | 'sega-mega-drive'

const NES_MAGIC = Buffer.from([0x4e, 0x45, 0x53, 0x1a]) // "NES\x1a"
const SEGA_MAGIC = Buffer.from('SEGA', 'ascii')
const NINTENDO_LOGO_HEAD = Buffer.from([0xce, 0xed, 0x66, 0x66]) // first bytes of the GB/GBC boot logo

/** Extracts a file's extension, lowercased, dot included (e.g. `.sfc`). */
export function normalizeExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase()
}

/** Checks whether a file's extension is one of the known ROM extensions. */
export function isRomFile(
  fileName: string,
  knownExtensions: string[],
): boolean {
  const ext = normalizeExtension(fileName)
  return knownExtensions.map((e) => e.toLowerCase()).includes(ext)
}

/**
 * Returns the ids of every platform whose extension list contains `ext`.
 * Empty means unknown, more than one means the extension alone can't decide
 * and a magic-byte tie-break (see below) is needed.
 */
export function guessPlatformFromExtension(
  ext: string,
  platforms: PlatformDefinition[],
): string[] {
  const normalized = ext.toLowerCase()
  return platforms
    .filter((platform) =>
      platform.extensions.map((e) => e.toLowerCase()).includes(normalized),
    )
    .map((platform) => platform.id)
}

/** MegaDrive ROMs (.bin, .md) carry "SEGA" at offset 0x100. */
export function hasSegaMegaDriveHeader(bytes: Buffer): boolean {
  return bytes.subarray(0x100, 0x100 + SEGA_MAGIC.length).equals(SEGA_MAGIC)
}

/** Rejects a `.md` that is actually Markdown: ROMs are binary, prose is not. */
export function looksLikeText(bytes: Buffer): boolean {
  if (bytes.length === 0) return false

  const sample = bytes.subarray(0, Math.min(bytes.length, 512))
  let printable = 0
  for (const byte of sample) {
    if (byte === 0x00) return false // binary data; text never contains a NUL this early
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e
    const isCommonWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d
    if (isPrintableAscii || isCommonWhitespace) printable++
  }

  return printable / sample.length > 0.95
}

/** SNES copier headers (.smc/.sfc) pad the file to a 512-byte offset. */
export function hasSnesCopierHeader(sizeBytes: number): boolean {
  return sizeBytes % 1024 === 512
}

/** Game Boy / Game Boy Color cartridges start with the Nintendo boot logo at 0x104. */
export function hasNintendoLogo(bytes: Buffer): boolean {
  if (bytes.length < 0x104 + NINTENDO_LOGO_HEAD.length) return false
  return bytes
    .subarray(0x104, 0x104 + NINTENDO_LOGO_HEAD.length)
    .equals(NINTENDO_LOGO_HEAD)
}

/** The CGB flag at 0x143 tells Game Boy Color apart from plain Game Boy. */
export function isColorGameBoyCartridge(bytes: Buffer): boolean {
  if (bytes.length <= 0x143) return false
  const cgbFlag = bytes[0x143]
  return cgbFlag === 0x80 || cgbFlag === 0xc0
}

/** `.nes` is already unambiguous; this only confirms the iNES header. */
export function hasNesMagic(bytes: Buffer): boolean {
  return (
    bytes.length >= NES_MAGIC.length &&
    bytes.subarray(0, NES_MAGIC.length).equals(NES_MAGIC)
  )
}

/** Every GBA cartridge header carries the fixed value 0x96 at 0xB2. */
export function hasGbaHeader(bytes: Buffer): boolean {
  return bytes[0xb2] === 0x96
}

/**
 * Detects the platform of a ROM from its extension, breaking ties and
 * rejecting look-alikes with magic bytes. `head` is the start of the file
 * (at least 512 bytes when the file is that long).
 * @returns null when the file is not a valid ROM of a known platform
 */
export function detectPlatformSlug(
  fileName: string,
  head: Buffer,
): PlatformSlug | null {
  const extension = normalizeExtension(fileName)

  switch (extension) {
    case '.nes':
      return hasNesMagic(head) ? 'nintendo-nes' : null
    case '.sfc':
    case '.smc':
      // No magic bytes on SNES: only an empty file is rejected
      return head.length > 0 ? 'nintendo-snes' : null
    case '.gb':
    case '.gbc':
      if (!hasNintendoLogo(head)) return null
      // 0xC0 is GBC-only; 0x80 (dual mode) exists in both No-Intro catalogs,
      // so the extension decides, e.g. Pokemon Yellow (.gb) vs Pokemon Gold (.gbc)
      if (head[0x143] === 0xc0) return 'nintendo-game-boy-color'
      return isColorGameBoyCartridge(head) && extension === '.gbc'
        ? 'nintendo-game-boy-color'
        : 'nintendo-game-boy'
    case '.gba':
      return hasGbaHeader(head) ? 'nintendo-game-boy-advance' : null
    case '.md':
      // A Markdown file could contain "SEGA" at 0x100 by chance
      if (looksLikeText(head)) return null
      return hasSegaMegaDriveHeader(head) ? 'sega-mega-drive' : null
    case '.bin':
    case '.gen':
      return hasSegaMegaDriveHeader(head) ? 'sega-mega-drive' : null
    default:
      return null
  }
}
