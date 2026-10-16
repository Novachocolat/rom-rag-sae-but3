import { normalizeTitle } from './title-normalizer.service.js'

export interface RomForEmbedding {
  title: string | null
  fileName: string
  publisher: string | null
  genre: string | null
  releaseYear: number | null
  languages: string[]
  platform: { name: string } | null
}

/**
 * Composes the text that gets vectorized for a ROM: base title, platform,
 * publisher, genre, year and languages. Region and revision are left out on
 * purpose, they are what tells apart the variants that must end up close.
 */
export function buildEmbeddingText(rom: RomForEmbedding): string {
  const parts = [
    normalizeTitle(rom.title ?? rom.fileName).baseTitle,
    rom.platform?.name,
    rom.publisher,
    rom.genre,
    rom.releaseYear === null ? undefined : String(rom.releaseYear),
    rom.languages.length > 0 ? rom.languages.join(', ') : undefined,
  ]

  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' | ')
}
