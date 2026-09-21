import { describe, expect, it } from 'vitest'
import { normalizeTitle } from './title-normalizer.service.js'

describe('normalizeTitle', () => {
  it('extrait la région simple', () => {
    const result = normalizeTitle('Super Mario Kart (Europe).sfc')
    expect(result.region).toBe('Europe')
    expect(result.baseTitle).toBe('super mario kart')
  })

  it('extrait une région composite (USA, Europe)', () => {
    const result = normalizeTitle('Tetris (USA, Europe).gb')
    expect(result.region).toBe('USA, Europe')
  })

  it('extrait les langues', () => {
    const result = normalizeTitle('Super Mario Kart (Europe) (En,Fr,De).sfc')
    expect(result.languages).toEqual(['En', 'Fr', 'De'])
  })

  it('extrait une révision numérique', () => {
    const result = normalizeTitle('Pokemon Red (USA) (Rev 1).gb')
    expect(result.revision).toBe('Rev 1')
  })

  it('extrait une révision lettre', () => {
    const result = normalizeTitle('Pokemon Red (USA) (Rev A).gb')
    expect(result.revision).toBe('Rev A')
  })

  it.each(['Beta', 'Proto', 'Demo', 'Sample', 'Unl'])(
    'extrait la mention spéciale (%s)',
    (tag) => {
      const result = normalizeTitle(`Some Game (USA) (${tag}).gb`)
      expect(result.revision).toBe(tag)
    },
  )

  it('sort les mentions techniques du baseTitle sans les perdre', () => {
    const result = normalizeTitle(
      'Pokemon - Version Or (France) (SGB Enhanced) (GB Compatible).gbc',
    )
    expect(result.baseTitle).toBe('pokemon version or')
    expect(result.flags).toEqual(['SGB Enhanced', 'GB Compatible'])
  })

  it('ne confond pas Version Or / Rouge / Bleue / Jaune', () => {
    const or = normalizeTitle('Pokemon - Version Or (France).gbc')
    const rouge = normalizeTitle('Pokemon - Version Rouge (France).gb')
    const bleue = normalizeTitle('Pokemon - Version Bleue (France).gb')
    expect(or.baseTitle).not.toBe(rouge.baseTitle)
    expect(rouge.baseTitle).not.toBe(bleue.baseTitle)
  })

  it('réordonne "The" antéposé pour matcher la forme No-Intro', () => {
    const fromUnderscore = normalizeTitle(
      'The_Legend_of_Zelda_-_Ocarina_of_Time (USA) (Rev 1).zip',
    )
    const noIntroForm = normalizeTitle(
      'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1).zip',
    )
    expect(fromUnderscore.baseTitle).toBe(noIntroForm.baseTitle)
  })

  it('réordonne "A" et "An" antéposés', () => {
    const a = normalizeTitle('A_Boy_and_His_Blob (USA).nes')
    expect(a.baseTitle).toBe('boy and his blob a')
  })

  it('retire les marqueurs GoodTools [!] et [b] même en fin de nom', () => {
    const bang = normalizeTitle('Super Mario Kart (Europe) (En,Fr,De).sfc [!]')
    const bad = normalizeTitle('Super Mario Kart (Europe) [b1].sfc')
    expect(bang.baseTitle).toBe('super mario kart')
    expect(bad.baseTitle).toBe('super mario kart')
  })

  it('gère un nom sans aucun tag', () => {
    const result = normalizeTitle('Tetris.gb')
    expect(result.baseTitle).toBe('tetris')
    expect(result.region).toBeNull()
    expect(result.revision).toBeNull()
    expect(result.languages).toEqual([])
    expect(result.flags).toEqual([])
  })

  it('conserve un tag non reconnu dans flags plutôt que de le perdre', () => {
    const result = normalizeTitle('Some Game (USA) (Kiosk Demo).nes')
    expect(result.flags).toContain('Kiosk Demo')
  })

  it('collapse les espaces multiples issus du retrait des tags', () => {
    const result = normalizeTitle('Sonic   the   Hedgehog (World).md')
    expect(result.baseTitle).toBe('sonic the hedgehog')
  })
})
