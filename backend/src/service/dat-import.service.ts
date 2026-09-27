import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/error.js'
import { parseDatXml } from './dat-parser.service.js'
import {
  upsertDatFile,
  bulkInsertEntries,
  findDatFileByContentSha1,
  createPlatform,
  findPlatformBySlug,
  listDatFiles,
  deleteDatFile as deleteDatFileStorage,
  type DatEntryInput,
} from '../storage/dat.storage.js'

// Resolves to the dataset directory
const DAT_DATASET_DIR = path.resolve(process.cwd(), '../dataset/dat')

// Slugs do not always match their platform names, so a mapping is necessary here
// TODO: Add other platforms <-> slugs here if wanted
const HEADER_NAME_TO_SLUG: Record<string, string> = {
  'Nintendo - Nintendo Entertainment System (Headered)': 'nintendo-nes',
  'Nintendo - Super Nintendo Entertainment System': 'nintendo-snes',
  'Nintendo - Game Boy': 'nintendo-game-boy',
  'Nintendo - Game Boy Color': 'nintendo-game-boy-color',
  'Nintendo - Game Boy Advance': 'nintendo-game-boy-advance',
  'Sega - Mega Drive - Genesis': 'sega-mega-drive',
}

// Fallback by slugifying the name if the header is ever unknown
function slugifyHeaderName(headerName: string): string {
  return (
    HEADER_NAME_TO_SLUG[headerName] ??
    headerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

// Links a .dat file to its platform; creates one if it does not exist
async function resolvePlatform(headerName: string) {
  const slug = slugifyHeaderName(headerName)
  const existing = await findPlatformBySlug({ prisma }, slug)
  if (existing) return existing

  return createPlatform({ prisma }, { slug, name: headerName, extensions: [] })
}

// Avoids path traversal by keeping `fileName` as a simple file name
function resolveDatFilePath(fileName: string): string {
  const resolved = path.resolve(DAT_DATASET_DIR, fileName)

  if (path.dirname(resolved) !== DAT_DATASET_DIR) {
    throw AppError.badRequest(
      'INVALID_FILE_NAME',
      'Le nom de fichier fourni est invalide',
    )
  }
  return resolved
}

export async function importDatFile(fileName: string) {
  const filePath = resolveDatFilePath(fileName)

  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch {
    throw AppError.notFound(
      'DAT_FILE_NOT_FOUND',
      `Le fichier est introuvable : ${fileName}`,
    )
  }

  // 1. Avoid importing the same .dat file twice
  const contentSha1 = createHash('sha1').update(buffer).digest('hex')
  const alreadyImported = await findDatFileByContentSha1(
    { prisma },
    contentSha1,
  )

  if (alreadyImported) {
    throw AppError.conflict(
      'DAT_ALREADY_IMPORTED',
      'Ce fichier .dat a déjà été importé',
      { datFileId: alreadyImported.id },
    )
  }

  // 2. parseDatXml throws a ZodError if the XML is malformed
  const { header, entries } = parseDatXml(buffer.toString('utf-8'))
  const platform = await resolvePlatform(header.name)

  // 3. A game can contains multiple ROMs (e.g. NES Headered)
  const flatRoms = entries.flatMap((game) => {
    return game.rom.map((rom) => ({
      game,
      rom,
    }))
  })

  const datFile = await upsertDatFile(
    { prisma },
    {
      platformId: platform.id,
      headerName: header.name,
      version: header.version,
      fileName,
      entryCount: flatRoms.length,
      contentSha1,
    },
  )

  const entryInputs: DatEntryInput[] = flatRoms.map(({ game, rom }) => ({
    datFileId: datFile.id,
    gameName: game.name,
    gameExternalId: game.id,
    cloneOfId: game.cloneofid,
    description: game.description ?? game.name,
    categories: game.category,
    serial: undefined,
    romName: rom.name,
    sizeBytes: rom.size,
    crc: rom.crc,
    md5: rom.md5,
    sha1: rom.sha1,
    sha256: rom.sha256,
    status: rom.status,
  }))

  const insertedEntries = await bulkInsertEntries({ prisma }, entryInputs)

  return {
    datFile,
    insertedEntries,
  }
}

// Lists every imported .dat catalog, with their platform
export async function getDatCatalog() {
  return listDatFiles({ prisma })
}

/**
 * Deletes a imported .dat catalog with its entries
 * @param {string} id - ID of the .dat file to delete
 */
export async function deleteDatFile(id: string) {
  return deleteDatFileStorage({ prisma }, id)
}
