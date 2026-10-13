import { describe, expect, it } from 'vitest'
import { buildEmbeddingText } from './embedding-text.service.js'

const base = {
  title: null,
  fileName: 'Pokemon - Version Rouge (France) (SGB Enhanced).gb',
  publisher: null,
  genre: null,
  releaseYear: null,
  languages: [],
  platform: null,
}

// Tests for the text composed from a ROM before it is vectorized
describe('buildEmbeddingText', () => {
  it('composes title, platform, publisher, genre, year and languages', () => {
    const text = buildEmbeddingText({
      ...base,
      title: 'Pokemon - Version Rouge',
      platform: { name: 'Nintendo Game Boy' },
      publisher: 'Nintendo',
      genre: 'RPG',
      releaseYear: 1999,
      languages: ['fr'],
    })

    expect(text).toBe(
      'pokemon version rouge | Nintendo Game Boy | Nintendo | RPG | 1999 | fr',
    )
  })

  it('falls back to the file name and drops empty fields', () => {
    const text = buildEmbeddingText(base)

    expect(text).toBe('pokemon version rouge')
  })

  it('leaves the region and the revision out', () => {
    const text = buildEmbeddingText({
      ...base,
      fileName: 'Tetris (Europe) (Rev 1).gb',
    })

    expect(text).toBe('tetris')
  })
})
