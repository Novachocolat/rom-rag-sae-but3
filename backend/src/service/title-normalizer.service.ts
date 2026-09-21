export interface NormalizedTitle {
  baseTitle: string
  region: string | null
  languages: string[]
  revision: string | null
  flags: string[]
}
// Normalization of ROM title from file name
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
// Regular expressions to match revision tags
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

    flags.push(tag)
  }

  return {
    baseTitle: buildBaseTitle(working),
    region,
    languages,
    revision,
    flags,
  }
}
// Helper to build the base title from the remaining string after removing tags
function buildBaseTitle(remainder: string): string {
  let title = remainder.replace(/\s+/g, ' ').trim().replace(/-\s*$/, '').trim()

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
// Helper to capitalize the first letter of a string and lowercase the rest
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
