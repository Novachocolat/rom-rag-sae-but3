import { prisma } from '@repo/backend/src/lib/prisma.js'
import { logger } from '@repo/backend/src/lib/logger.js'
import { readdir } from 'node:fs/promises'
import { env } from '@repo/backend/src/env.js'
import { AppError } from '@repo/backend/src/lib/error.js'
import { hashPassword } from '@repo/backend/src/service/auth.service.js'
import {
  DAT_DATASET_DIR,
  importDatFile,
} from '@repo/backend/src/service/dat-import.service.js'

// The platforms of the dataset; their extensions must also appear in ROM_EXTENSIONS
const PLATFORMS = [
  {
    slug: 'nintendo-nes',
    name: 'Nintendo Entertainment System',
    shortName: 'NES',
    extensions: ['.nes'],
  },
  {
    slug: 'nintendo-snes',
    name: 'Super Nintendo Entertainment System',
    shortName: 'SNES',
    extensions: ['.sfc', '.smc'],
  },
  {
    slug: 'nintendo-game-boy',
    name: 'Nintendo Game Boy',
    shortName: 'GB',
    extensions: ['.gb'],
  },
  {
    slug: 'nintendo-game-boy-color',
    name: 'Nintendo Game Boy Color',
    shortName: 'GBC',
    extensions: ['.gbc'],
  },
  {
    slug: 'nintendo-game-boy-advance',
    name: 'Nintendo Game Boy Advance',
    shortName: 'GBA',
    extensions: ['.gba'],
  },
  {
    slug: 'sega-mega-drive',
    name: 'Sega Mega Drive - Genesis',
    shortName: 'MD',
    extensions: ['.md', '.bin', '.gen'],
  },
]

// Account used by scripts/DEMO.md; its password comes from .env, never from the code
const DEMO_USER = { email: 'demo@example.com', displayName: 'Demo' }

// Upserts by slug to avoid duplicates
async function seedPlatforms(): Promise<void> {
  for (const { slug, ...data } of PLATFORMS) {
    await prisma.platform.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
    })
  }
}

// Imports every .dat of dataset/dat; one already imported (same content) is skipped
async function seedCatalogs(): Promise<{ imported: number; skipped: number }> {
  const fileNames = (await readdir(DAT_DATASET_DIR))
    .filter(
      (fileName) =>
        fileName.endsWith('.dat') && !fileName.includes('(Headered)'), // Headered are duplicates of the same dat, but with a header that is not used by the import
    )
    .sort()

  let imported = 0
  let skipped = 0
  for (const fileName of fileNames) {
    try {
      const { insertedEntries } = await importDatFile(fileName)
      logger.info('Catalog imported', { fileName, entries: insertedEntries })
      imported++
    } catch (error) {
      if (error instanceof AppError && error.code === 'DAT_ALREADY_IMPORTED') {
        skipped++
        continue
      }
      throw error
    }
  }
  return { imported, skipped }
}

// Creates the demo user once
async function seedDemoUser(): Promise<void> {
  await prisma.user.upsert({
    where: { email: DEMO_USER.email },
    update: {},
    create: {
      ...DEMO_USER,
      passwordHash: await hashPassword(env.DEMO_USER_PASSWORD),
    },
  })
}

// Platforms first: a catalog would otherwise create its platform without extensions
async function main(): Promise<void> {
  await seedPlatforms()
  const catalogs = await seedCatalogs()
  await seedDemoUser()
  logger.info('🎊 seeding succeeded', {
    plateforms: PLATFORMS.length,
    ...catalogs,
    demoUser: DEMO_USER.email,
  })
}

main()
  .catch((error: unknown) => {
    logger.error('Seed failed', {
      stack: error instanceof Error ? error.stack : String(error),
    })
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
