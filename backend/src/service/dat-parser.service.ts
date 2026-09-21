import { XMLParser } from 'fast-xml-parser'
import { datFileSummarySchema } from '@repo/shared/schemas'
import type { DatHeader, DatGame } from '@repo/shared/types'

// Structured output of a parsed .dat file
export interface ParsedDat {
  header: DatHeader
  entries: DatGame[]
}

// Configures the XML parser to parse No-Intro .dat files
const parser = new XMLParser({
  ignoreAttributes: false, // Ensures attributes and structural checksums (name, size, crc) are kept
  attributeNamePrefix: '',
  parseAttributeValue: false, // Datatype management is delegated to Zod
  processEntities: true, // Decodes natively HTML entities (e.g. &amp; -> &)
})

/**
 * Parses a .dat No-Intro file (Logiqx XML format) into a structured object ParsedData
 * @param {string} xmlString - String to parse
 * @throws {z.ZodError} if the XML does not match the schema
 * @returns
 */
export function parseDatXml(xmlString: string): ParsedDat {
  const rawParsed: unknown = parser.parse(xmlString)
  const result = datFileSummarySchema.parse(rawParsed)

  return {
    header: result.datafile.header,
    entries: result.datafile.game,
  }
}
