// Lists how each file of dataset/roms matches dataset/dat, with the scanner's
// hashes: raw, then without the iNES (16 bytes) or SNES copier (512) header.
// Usage: node scripts/check-dataset.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const DATASET = path.resolve(import.meta.dirname, '../../dataset')
const HEADER_SIZES = { '.nes': 16, '.sfc': 512, '.smc': 512 }
const GAME_REGEX =
  /<game name="([^"]*)" id="([^"]*)"(?: cloneofid="([^"]*)")?[^>]*>([\s\S]*?)<\/game>/g

const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex')

// SHA-1 -> catalog game; a regex is enough for No-Intro's flat XML
const catalog = new Map()
for (const file of readdirSync(path.join(DATASET, 'dat'))) {
  const xml = readFileSync(path.join(DATASET, 'dat', file), 'utf8')
  for (const [, name, id, cloneOfId, body] of xml.matchAll(GAME_REGEX)) {
    for (const [, hash] of body.matchAll(/sha1="([0-9a-f]{40})"/gi)) {
      catalog.set(hash.toLowerCase(), {
        name: name.replaceAll('&amp;', '&'),
        id,
        cloneOfId,
      })
    }
  }
}

const roms = readdirSync(path.join(DATASET, 'roms'), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name))
  .sort()

let identified = 0
for (const file of roms) {
  const bytes = readFileSync(file)
  const header = HEADER_SIZES[path.extname(file).toLowerCase()] ?? 0

  let how = 'SHA1'
  let match = catalog.get(sha1(bytes))
  if (!match && header && bytes.length > header) {
    how = 'SHA1_DATA'
    match = catalog.get(sha1(bytes.subarray(header)))
  }
  if (match) identified++

  const relative = path.relative(path.join(DATASET, 'roms'), file)
  const family = match?.cloneOfId ? `, clone of ${match.cloneOfId}` : ''
  console.log(
    `${(match ? how : 'NONE').padEnd(9)} ${relative.padEnd(58)} ${
      match ? `${match.name} [id ${match.id}${family}]` : '-'
    }`,
  )
}
console.log(`\n${identified}/${roms.length} files match a catalog`)
