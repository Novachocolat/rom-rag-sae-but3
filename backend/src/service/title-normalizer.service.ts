// backend/src/service/title-normalizer.service.ts
// Service pur : normalisation No-Intro (région, langues, révision, flags)
// + clé baseTitle pour regrouper les variantes d'un même jeu.

export interface NormalizedTitle {
  baseTitle: string
  region: string | null
  languages: string[]
  revision: string | null
  flags: string[]
}

const REGION_TOKENS = new Set([
  'usa',
  'europe',
  'world',
  'japan',
  'asia',
  'australia',
  'brazil',
  'canada',
  'china',
  'denmark',
  'finland',
  'france',
  'germany',
  'greece',
  'hong kong',
  'ireland',
  'italy',
  'korea',
  'netherlands',
  'norway',
  'poland',
  'portugal',
  'russia',
  'scandinavia',
  'spain',
  'sweden',
  'switzerland',
  'taiwan',
  'uk',
  'unknown',
  'united kingdom',
])

const LANGUAGE_CODES = new Set([
  'en',
  'fr',
  'de',
  'es',
  'it',
  'nl',
  'pt',
  'sv',
  'no',
  'da',
  'fi',
  'zh',
  'ja',
  'ko',
  'pl',
  'ru',
  'hu',
  'cs',
  'el',
  'tr',
  'ar',
  'he',
  'uk',
])

const TECH_FLAGS = new Set([
  'sgb enhanced',
  'cgb+sgb enhanced',
  'gb compatible',
])

const REVISION_REGEX = /^rev(?:ision)?\.?\s*([0-9]+|[a-z])$/i
const SPECIAL_REVISION_REGEX =
  /^(beta|proto|prototype|demo|sample|unl|unlicensed)(\s*\d+)?$/i

export function normalizeTitle(fileName: string): NormalizedTitle {
  let working = fileName.replace(/_/g, ' ')
  working = working.replace(/\[[^\]]*\]/g, ' ') // marqueurs GoodTools ([!], [b]...)

  const tags: string[] = []
  working = working.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    tags.push(inner.trim())
    return ' '
  })

  // extension retirée après les tags, sinon "Title.sfc [!]" ne se termine
  // pas par l'extension une fois [!] encore présent
  working = working.replace(/\.[a-z0-9]{1,4}\s*$/i, '')

  let region: string | null = null
  const languages: string[] = []
  let revision: string | null = null
  const flags: string[] = []

  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (!tag) continue

    const tokens = tag
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    if (
      tokens.length > 0 &&
      tokens.every((t) => REGION_TOKENS.has(t.toLowerCase()))
    ) {
      region = region ?? tag
      continue
    }

    if (
      tokens.length > 0 &&
      tokens.every((t) => LANGUAGE_CODES.has(t.toLowerCase()))
    ) {
      languages.push(...tokens.map(capitalize))
      continue
    }

    if (REVISION_REGEX.test(tag) || SPECIAL_REVISION_REGEX.test(tag)) {
      revision = revision ?? tag
      continue
    }

    if (TECH_FLAGS.has(tag.toLowerCase())) {
      flags.push(tag)
      continue
    }

    flags.push(tag) // tag non reconnu : conservé plutôt que perdu
  }

  return {
    baseTitle: buildBaseTitle(working),
    region,
    languages,
    revision,
    flags,
  }
}

function buildBaseTitle(remainder: string): string {
  let title = remainder.replace(/\s+/g, ' ').trim().replace(/-\s*$/, '').trim()

  // article antéposé -> postposé, sur le titre principal seulement, pour
  // faire converger "The_Legend_of_Zelda_-_X" et "Legend of Zelda, The - X"
  const separatorIndex = title.indexOf(' - ')
  const mainPart =
    separatorIndex === -1 ? title : title.slice(0, separatorIndex)
  const subtitlePart = separatorIndex === -1 ? '' : title.slice(separatorIndex)

  const articleMatch = mainPart.match(/^(the|a|an)\s+(.+)$/i)
  let reorderedMain = mainPart
  if (articleMatch) {
    const [, article, rest] = articleMatch as [string, string, string]
    reorderedMain = `${rest}, ${capitalize(article)}`
  }

  title = `${reorderedMain}${subtitlePart}`.trim()

  return title
    .toLowerCase()
    .replace(/['".!?:;]/g, '')
    .replace(/[-,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
