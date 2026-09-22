import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  '../../prisma/migrations',
)
const HNSW_INDEX = 'romembedding_embedding_hnsw'
const INDEX_STATEMENT_RE = new RegExp(
  `(CREATE|DROP)\\s+INDEX\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?"?${HNSW_INDEX}"?`,
  'gi',
)

// Reads every migration.sql in apply order, without its `--` comments
function readMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) =>
      readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n'),
    )
}

// Replays CREATE/DROP statements on the HNSW index and tells whether it exists at the end
function hnswIndexExistsAfter(sqlFiles: string[]): boolean {
  let exists = false
  for (const sql of sqlFiles) {
    for (const match of sql.matchAll(INDEX_STATEMENT_RE)) {
      exists = match[1]!.toUpperCase() === 'CREATE'
    }
  }
  return exists
}

/**
 * Prisma cannot express the HNSW index, so `prisma migrate dev` adds a DROP INDEX to every
 * migration it generates: this test catch it before the migration reaches a database
 */
describe('prisma migrations', () => {
  it('must not drop the HNSW index after the last Prisma migration', () => {
    const migrations = readMigrations()

    expect(migrations.length).toBeGreaterThan(0)
    expect(hnswIndexExistsAfter(migrations)).toBe(true)
  })
})
