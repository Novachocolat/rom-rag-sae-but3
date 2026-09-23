import { describe, expect, it, vi } from 'vitest'
import {
  identifyRom,
  type DatEntry,
  type DatLookup,
  type RomCandidate,
} from './identification.service.js'

function makeCandidate(overrides: Partial<RomCandidate> = {}): RomCandidate {
  return {
    fileName: 'Super Mario Kart (Europe).sfc',
    sha1FullFile: 'sha1-full',
    md5FullFile: 'md5-full',
    sha1Data: 'sha1-data',
    md5Data: 'md5-data',
    headerBytesSkipped: 0,
    normalizedName: 'super mario kart',
    ...overrides,
  }
}
function makeEntry(name: string): DatEntry {
  return { name, sha1: 'x', md5: 'y' }
}
// Helper to create a mock DatLookup with optional overrides
function makeLookup(overrides: Partial<DatLookup> = {}): DatLookup {
  return {
    findBySha1Full: vi.fn().mockResolvedValue(null),
    findByMd5Full: vi.fn().mockResolvedValue(null),
    findBySha1Data: vi.fn().mockResolvedValue(null),
    findByMd5Data: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}
// Tests for identifyRom function
describe('identifyRom', () => {
  it('retourne DAT_SHA1 en priorité même si les autres échelons matcheraient', async () => {
    const entry = makeEntry('Match SHA1')
    const lookup = makeLookup({
      findBySha1Full: vi.fn().mockResolvedValue(entry),
      findByMd5Full: vi.fn().mockResolvedValue(makeEntry('Match MD5')),
    })

    const result = await identifyRom(makeCandidate(), lookup)

    expect(result.source).toBe('DAT_SHA1')
    expect(result.confidence).toBe(1.0)
    expect(result.entry).toBe(entry)
    expect(lookup.findByMd5Full).not.toHaveBeenCalled()
  })

  it('retombe sur DAT_MD5 si SHA-1 fichier entier ne matche pas', async () => {
    const entry = makeEntry('Match MD5')
    const lookup = makeLookup({
      findByMd5Full: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(makeCandidate(), lookup)

    expect(result.source).toBe('DAT_MD5')
    expect(result.confidence).toBe(0.99)
  })

  it("n'appelle pas les échelons données-seules si headerBytesSkipped === 0 (GB/GBC/GBA)", async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ headerBytesSkipped: 0 }), lookup)

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })

  it('évalue SHA-1 données seules quand headerBytesSkipped > 0', async () => {
    const entry = makeEntry('Match SHA1 data')
    const lookup = makeLookup({
      findBySha1Data: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_SHA1_DATA')
    expect(result.confidence).toBe(0.97)
  })

  it('retombe sur MD5 données seules si SHA-1 données seules ne matche pas', async () => {
    const entry = makeEntry('Match MD5 data')
    const lookup = makeLookup({
      findByMd5Data: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_MD5_DATA')
    expect(result.confidence).toBe(0.96)
  })

  it('retombe sur DAT_NAME en dernier recours avant échec', async () => {
    const entry = makeEntry('Match name')
    const lookup = makeLookup({
      findByNormalizedName: vi.fn().mockResolvedValue(entry),
    })

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('DAT_NAME')
    expect(result.confidence).toBe(0.8)
  })

  it('ne tente pas la recherche par nom si normalizedName est absent', async () => {
    const lookup = makeLookup()

    await identifyRom(makeCandidate({ normalizedName: null }), lookup)

    expect(lookup.findByNormalizedName).not.toHaveBeenCalled()
  })

  it('retourne UNIDENTIFIED si aucun échelon ne matche', async () => {
    const lookup = makeLookup()

    const result = await identifyRom(
      makeCandidate({ headerBytesSkipped: 512 }),
      lookup,
    )

    expect(result.source).toBe('UNIDENTIFIED')
    expect(result.confidence).toBe(0)
    expect(result.entry).toBeNull()
  })

  it("n'appelle pas les échelons données-seules si les empreintes _Data sont absentes", async () => {
    const lookup = makeLookup()

    await identifyRom(
      makeCandidate({ headerBytesSkipped: 512, sha1Data: null, md5Data: null }),
      lookup,
    )

    expect(lookup.findBySha1Data).not.toHaveBeenCalled()
    expect(lookup.findByMd5Data).not.toHaveBeenCalled()
  })
})
