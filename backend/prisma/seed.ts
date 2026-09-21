import { prisma } from '@repo/backend/src/lib/prisma.js'
import { logger } from '@repo/backend/src/lib/logger.js'

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

// Upserts by slug to avoid duplicates
async function main(): Promise<void> {
  for (const { slug, ...data } of PLATFORMS) {
    await prisma.platform.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
    })
  }

  logger.info('🎊 seeding succeded', { platforms: PLATFORMS.length })
}

main()
  .catch((error: unknown) => {
    logger.error('Échec du seed', {
      stack: error instanceof Error ? error.stack : String(error),
    })
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
