import { describe, expect, it } from 'vitest'
import {
  guessPlatformFromExtension,
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
