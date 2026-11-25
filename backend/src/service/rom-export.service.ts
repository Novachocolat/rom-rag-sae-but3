export interface RomExportRow {
  title: string | null
  fileName: string
  relativePath: string
  platform: string | null
  region: string | null
  releaseYear: number | null
  sizeBytes: number
  identificationSource: string
  confidence: number | null
  md5: string
  sha1: string
}

const COLUMNS: (keyof RomExportRow)[] = [
  'title',
  'fileName',
  'relativePath',
  'platform',
  'region',
  'releaseYear',
  'sizeBytes',
  'identificationSource',
  'confidence',
  'md5',
  'sha1',
]

// Spreadsheets evaluate a cell starting with one of these as a formula
const FORMULA_PREFIX = /^[=+\-@\t\r]/

function toCsvField(value: string | number | null): string {
  if (value === null) return ''
  const text =
    typeof value === 'string' && FORMULA_PREFIX.test(value)
      ? `'${value}`
      : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Serializes ROMs as RFC 4180 CSV, with a BOM so Excel reads accented titles as UTF-8. */
export function toCsv(rows: RomExportRow[]): string {
  const lines = [
    COLUMNS.join(','),
    ...rows.map((row) =>
      COLUMNS.map((column) => toCsvField(row[column])).join(','),
    ),
  ]
  return `\uFEFF${lines.map((line) => `${line}\r\n`).join('')}`
}
