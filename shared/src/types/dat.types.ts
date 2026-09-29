import type { z } from 'zod'
import type {
  datHeaderSchema,
  datGameSchema,
  datRomSchema,
} from '../schemas/dat.schema.js'

export type DatHeader = z.infer<typeof datHeaderSchema>
export type DatGame = z.infer<typeof datGameSchema>
export type DatRom = z.infer<typeof datRomSchema>
