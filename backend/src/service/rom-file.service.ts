import path from 'node:path'

// Pure logic (no I/O): easy to test exhaustively.

export interface PlatformDefinition {
  id: string
  extensions: string[]
}

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
