// backend/src/service/identification.service.ts
export type IdentificationSource =
  | 'DAT_SHA1'
  | 'DAT_MD5'
  | 'DAT_SHA1_DATA'
  | 'DAT_MD5_DATA'
  | 'DAT_NAME'
  | 'UNIDENTIFIED'

export interface RomCandidate {
  fileName: string
  sha1FullFile: string
  md5FullFile: string
  sha1Data?: string | null
  md5Data?: string | null
  headerBytesSkipped: number
  normalizedName?: string | null
}

export interface DatEntry {
  name: string
  sha1: string
  md5: string
  [key: string]: unknown
}
export interface DatLookup {
  findBySha1Full(sha1: string): Promise<DatEntry | null>
  findByMd5Full(md5: string): Promise<DatEntry | null>
  findBySha1Data(sha1: string): Promise<DatEntry | null>
  findByMd5Data(md5: string): Promise<DatEntry | null>
  findByNormalizedName(name: string): Promise<DatEntry | null>
}

export interface IdentificationResult {
  source: IdentificationSource
  confidence: number
  entry: DatEntry | null
  candidate: RomCandidate
}

const CONFIDENCE: Record<IdentificationSource, number> = {
  DAT_SHA1: 1.0,
  DAT_MD5: 0.99,
  DAT_SHA1_DATA: 0.97,
  DAT_MD5_DATA: 0.96,
  DAT_NAME: 0.8,
  UNIDENTIFIED: 0,
}

// Identification of ROM candidate in a DAT ---
export async function identifyRom(
  candidate: RomCandidate,
  datLookup: DatLookup,
): Promise<IdentificationResult> {
  const bySha1 = await datLookup.findBySha1Full(candidate.sha1FullFile)
  if (bySha1) return buildResult('DAT_SHA1', bySha1, candidate)

  const byMd5 = await datLookup.findByMd5Full(candidate.md5FullFile)
  if (byMd5) return buildResult('DAT_MD5', byMd5, candidate)

  if (candidate.headerBytesSkipped > 0) {
    if (candidate.sha1Data) {
      const bySha1Data = await datLookup.findBySha1Data(candidate.sha1Data)
      if (bySha1Data) return buildResult('DAT_SHA1_DATA', bySha1Data, candidate)
    }

    if (candidate.md5Data) {
      const byMd5Data = await datLookup.findByMd5Data(candidate.md5Data)
      if (byMd5Data) return buildResult('DAT_MD5_DATA', byMd5Data, candidate)
    }
  }

  if (candidate.normalizedName) {
    const byName = await datLookup.findByNormalizedName(
      candidate.normalizedName,
    )
    if (byName) return buildResult('DAT_NAME', byName, candidate)
  }

  return buildResult('UNIDENTIFIED', null, candidate)
}

function buildResult(
  source: IdentificationSource,
  entry: DatEntry | null,
  candidate: RomCandidate,
): IdentificationResult {
  return { source, confidence: CONFIDENCE[source], entry, candidate }
}
