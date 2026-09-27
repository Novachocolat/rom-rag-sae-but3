import { describe, expect, it } from 'vitest'
import { normalizeTitle } from './title-normalizer.service.js'

// Tests for normalizeTitle function
describe('normalizeTitle', () => {
  it('extracts a single region', () => {
    const result = normalizeTitle('Super Mario Kart (Europe).sfc')
    expect(result.region).toBe('Europe')
    expect(result.baseTitle).toBe('super mario kart')
  })

  it('extracts a composite region (USA, Europe)', () => {
    const result = normalizeTitle('Tetris (USA, Europe).gb')
    expect(result.region).toBe('USA, Europe')
  })

  it('extracts the languages', () => {
    const result = normalizeTitle('Super Mario Kart (Europe) (En,Fr,De).sfc')
    expect(result.languages).toEqual(['En', 'Fr', 'De'])
  })

  it('extracts a numeric revision', () => {
    const result = normalizeTitle('Pokemon Red (USA) (Rev 1).gb')
    expect(result.revision).toBe('Rev 1')
  })

  it('extracts a letter revision', () => {
    const result = normalizeTitle('Pokemon Red (USA) (Rev A).gb')
    expect(result.revision).toBe('Rev A')
  })

  it.each(['Beta', 'Proto', 'Demo', 'Sample', 'Unl'])(
    'extracts the special tag (%s)',
    (tag) => {
      const result = normalizeTitle(`Some Game (USA) (${tag}).gb`)
      expect(result.revision).toBe(tag)
    },
  )

  it('moves technical tags out of baseTitle without losing them', () => {
    const result = normalizeTitle(
      'Pokemon - Version Or (France) (SGB Enhanced) (GB Compatible).gbc',
    )
    expect(result.baseTitle).toBe('pokemon version or')
    expect(result.flags).toEqual(['SGB Enhanced', 'GB Compatible'])
  })

  it('tells Version Or / Rouge / Bleue / Jaune apart', () => {
    const or = normalizeTitle('Pokemon - Version Or (France).gbc')
    const rouge = normalizeTitle('Pokemon - Version Rouge (France).gb')
    const bleue = normalizeTitle('Pokemon - Version Bleue (France).gb')
    expect(or.baseTitle).not.toBe(rouge.baseTitle)
    expect(rouge.baseTitle).not.toBe(bleue.baseTitle)
  })

  it('moves a leading "The" to the end to match the No-Intro form', () => {
    const fromUnderscore = normalizeTitle(
      'The_Legend_of_Zelda_-_Ocarina_of_Time (USA) (Rev 1).zip',
    )
    const noIntroForm = normalizeTitle(
      'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1).zip',
    )
    expect(fromUnderscore.baseTitle).toBe(noIntroForm.baseTitle)
  })

  it('moves a leading "A" or "An" to the end', () => {
    const a = normalizeTitle('A_Boy_and_His_Blob (USA).nes')
    expect(a.baseTitle).toBe('boy and his blob a')
  })

  it('strips the GoodTools markers [!] and [b], even at the end of the name', () => {
    const bang = normalizeTitle('Super Mario Kart (Europe) (En,Fr,De).sfc [!]')
    const bad = normalizeTitle('Super Mario Kart (Europe) [b1].sfc')
    expect(bang.baseTitle).toBe('super mario kart')
    expect(bad.baseTitle).toBe('super mario kart')
  })

  it('handles a name without any tag', () => {
    const result = normalizeTitle('Tetris.gb')
    expect(result.baseTitle).toBe('tetris')
    expect(result.region).toBeNull()
    expect(result.revision).toBeNull()
    expect(result.languages).toEqual([])
    expect(result.flags).toEqual([])
  })

  it('keeps an unknown tag in flags instead of dropping it', () => {
    const result = normalizeTitle('Some Game (USA) (Kiosk Demo).nes')
    expect(result.flags).toContain('Kiosk Demo')
  })

  it('collapses the extra spaces left by removed tags', () => {
    const result = normalizeTitle('Sonic   the   Hedgehog (World).md')
    expect(result.baseTitle).toBe('sonic the hedgehog')
  })
})
