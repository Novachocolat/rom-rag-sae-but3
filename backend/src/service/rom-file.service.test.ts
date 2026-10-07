import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectPlatformSlug,
  guessPlatformFromExtension,
  hasGbaHeader,
  hasNesMagic,
  hasNintendoLogo,
  hasSegaMegaDriveHeader,
  hasSnesCopierHeader,
  isColorGameBoyCartridge,
  isRomFile,
  looksLikeText,
  normalizeExtension,
  type PlatformDefinition,
} from './rom-file.service.js'

const PLATFORMS: PlatformDefinition[] = [
  { id: 'nes', extensions: ['.nes'] },
  { id: 'snes', extensions: ['.smc', '.sfc'] },
  { id: 'gb', extensions: ['.gb'] },
  { id: 'gbc', extensions: ['.gbc'] },
  { id: 'megadrive', extensions: ['.bin', '.md'] },
]

// Builds a fake Game Boy header, with the boot logo and an optional CGB flag
function gameBoyHead(cgbFlag = 0x00): Buffer {
  const bytes = Buffer.alloc(0x150)
  Buffer.from([0xce, 0xed, 0x66, 0x66]).copy(bytes, 0x104)
  bytes[0x143] = cgbFlag
  return bytes
}

describe('normalizeExtension', () => {
  it('lowercases the extension', () => {
    expect(normalizeExtension('Game.SFC')).toBe('.sfc')
  })

  it('returns an empty string when there is no extension', () => {
    expect(normalizeExtension('Tetris')).toBe('')
  })
})

describe('isRomFile', () => {
  it('accepts a file whose extension is in the known list', () => {
    expect(isRomFile('Tetris.gb', ['.gb', '.gbc'])).toBe(true)
  })

  it('rejects a file whose extension is not in the known list', () => {
    expect(isRomFile('readme.txt', ['.gb', '.gbc'])).toBe(false)
  })

  it('is case-insensitive on both the file name and the known list', () => {
    expect(isRomFile('Tetris.GB', ['.Gb'])).toBe(true)
  })
})

describe('guessPlatformFromExtension', () => {
  it('returns the single matching platform id', () => {
    expect(guessPlatformFromExtension('.nes', PLATFORMS)).toEqual(['nes'])
  })

  it('returns an empty array for an unknown extension', () => {
    expect(guessPlatformFromExtension('.iso', PLATFORMS)).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(guessPlatformFromExtension('.SFC', PLATFORMS)).toEqual(['snes'])
  })
})

describe('hasSegaMegaDriveHeader', () => {
  it('detects "SEGA" at offset 0x100', () => {
    const bytes = Buffer.alloc(0x110)
    bytes.write('SEGA', 0x100, 'ascii')
    expect(hasSegaMegaDriveHeader(bytes)).toBe(true)
  })

  it('returns false when the marker is absent', () => {
    expect(hasSegaMegaDriveHeader(Buffer.alloc(0x110))).toBe(false)
  })

  it('returns false when the buffer is too short', () => {
    expect(hasSegaMegaDriveHeader(Buffer.alloc(4))).toBe(false)
  })
})

describe('looksLikeText', () => {
  it('recognizes a Markdown file as text', () => {
    const bytes = Buffer.from('# Title\n\nSome prose here.\n', 'utf8')
    expect(looksLikeText(bytes)).toBe(true)
  })

  it('rejects binary data containing a NUL byte', () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03])
    expect(looksLikeText(bytes)).toBe(false)
  })

  it('rejects an empty buffer', () => {
    expect(looksLikeText(Buffer.alloc(0))).toBe(false)
  })
})

describe('hasSnesCopierHeader', () => {
  it('detects the 512-byte copier padding', () => {
    expect(hasSnesCopierHeader(524800)).toBe(true)
  })

  it('returns false for a headerless ROM', () => {
    expect(hasSnesCopierHeader(524288)).toBe(false)
  })
})

describe('hasNintendoLogo', () => {
  it('detects the Nintendo boot logo at 0x104', () => {
    const bytes = Buffer.alloc(0x150)
    Buffer.from([0xce, 0xed, 0x66, 0x66]).copy(bytes, 0x104)
    expect(hasNintendoLogo(bytes)).toBe(true)
  })

  it('returns false when the logo is absent', () => {
    expect(hasNintendoLogo(Buffer.alloc(0x150))).toBe(false)
  })

  it('returns false when the buffer is too short', () => {
    expect(hasNintendoLogo(Buffer.alloc(0x10))).toBe(false)
  })
})

describe('isColorGameBoyCartridge', () => {
  it('recognizes the CGB-only flag (0x80)', () => {
    const bytes = Buffer.alloc(0x150)
    bytes[0x143] = 0x80
    expect(isColorGameBoyCartridge(bytes)).toBe(true)
  })

  it('recognizes the CGB-compatible flag (0xc0)', () => {
    const bytes = Buffer.alloc(0x150)
    bytes[0x143] = 0xc0
    expect(isColorGameBoyCartridge(bytes)).toBe(true)
  })

  it('returns false for a plain Game Boy cartridge', () => {
    const bytes = Buffer.alloc(0x150)
    bytes[0x143] = 0x00
    expect(isColorGameBoyCartridge(bytes)).toBe(false)
  })

  it('returns false when the buffer is too short', () => {
    expect(isColorGameBoyCartridge(Buffer.alloc(0x10))).toBe(false)
  })
})

describe('hasNesMagic', () => {
  it('confirms the iNES header', () => {
    expect(hasNesMagic(Buffer.from([0x4e, 0x45, 0x53, 0x1a, 0, 0]))).toBe(true)
  })

  it('returns false otherwise', () => {
    expect(hasNesMagic(Buffer.from([0, 0, 0, 0]))).toBe(false)
  })
})

describe('hasGbaHeader', () => {
  it('detects the fixed 0x96 value at 0xB2', () => {
    const bytes = Buffer.alloc(0xc0)
    bytes[0xb2] = 0x96
    expect(hasGbaHeader(bytes)).toBe(true)
  })

  it('returns false when the buffer is too short', () => {
    expect(hasGbaHeader(Buffer.alloc(0x10))).toBe(false)
  })
})

describe('detectPlatformSlug', () => {
  it('confirms .nes with the iNES magic and rejects it otherwise', () => {
    const ines = Buffer.from([0x4e, 0x45, 0x53, 0x1a, 0x02])
    expect(detectPlatformSlug('Game.nes', ines)).toBe('nintendo-nes')
    expect(detectPlatformSlug('Game.nes', Buffer.alloc(16))).toBeNull()
  })

  it('accepts any non-empty .sfc/.smc, with or without a copier header', () => {
    expect(detectPlatformSlug('Game.SFC', Buffer.alloc(512))).toBe(
      'nintendo-snes',
    )
    expect(detectPlatformSlug('Game.smc', Buffer.alloc(0))).toBeNull()
  })

  it('tells Game Boy from Game Boy Color with the CGB flag, then the extension', () => {
    expect(detectPlatformSlug('Game.gb', gameBoyHead(0x00))).toBe(
      'nintendo-game-boy',
    )
    expect(detectPlatformSlug('Game.gb', gameBoyHead(0xc0))).toBe(
      'nintendo-game-boy-color',
    )
    expect(detectPlatformSlug('Game.gb', gameBoyHead(0x80))).toBe(
      'nintendo-game-boy',
    )
    expect(detectPlatformSlug('Game.gbc', gameBoyHead(0x80))).toBe(
      'nintendo-game-boy-color',
    )
  })

  it('rejects a .gb without the Nintendo boot logo', () => {
    expect(detectPlatformSlug('Game.gb', Buffer.alloc(0x150))).toBeNull()
  })

  it('rejects a Markdown .md even if it contains SEGA at 0x100', () => {
    const markdown = Buffer.from('# Notes\n'.padEnd(0x100, '-') + 'SEGA text')
    expect(detectPlatformSlug('README.md', markdown)).toBeNull()
  })

  it('only accepts .bin/.gen/.md with the SEGA header at 0x100', () => {
    const megaDrive = Buffer.alloc(0x200)
    megaDrive.write('SEGA', 0x100, 'ascii')
    expect(detectPlatformSlug('Game.bin', megaDrive)).toBe('sega-mega-drive')
    expect(detectPlatformSlug('Game.md', megaDrive)).toBe('sega-mega-drive')
    expect(detectPlatformSlug('Game.bin', Buffer.alloc(0x200))).toBeNull()
  })

  it('returns null for an unknown extension', () => {
    expect(detectPlatformSlug('Game.iso', Buffer.alloc(512))).toBeNull()
  })
})

// Non-regression tests: every sample ROM is recognized and attributed to the platform of the folder it is stored in
describe('detectPlatformSlug on the dataset ROMs', () => {
  const ROMS_DIR = path.resolve(import.meta.dirname, '../../../dataset/roms')
  const EXPECTED_BY_FOLDER: Record<string, string> = {
    gb: 'nintendo-game-boy',
    gbc: 'nintendo-game-boy-color',
    gba: 'nintendo-game-boy-advance',
    nes: 'nintendo-nes',
    snes: 'nintendo-snes',
    megadrive: 'sega-mega-drive',
  }

  const samples = readdirSync(ROMS_DIR, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    // `broken/` holds the empty and truncated files, which must NOT be recognized
    .filter((entry) => !entry.parentPath.split(path.sep).includes('broken'))
    .map((entry) => {
      const relative = path.relative(
        ROMS_DIR,
        path.join(entry.parentPath, entry.name),
      )
      return [relative, relative.split(path.sep)[0] ?? ''] as const
    })

  it.each(samples)('%s is detected as a %s ROM', (relative, folder) => {
    const head = readFileSync(path.join(ROMS_DIR, relative)).subarray(0, 512)

    expect(detectPlatformSlug(relative, head)).toBe(EXPECTED_BY_FOLDER[folder])
  })
})
