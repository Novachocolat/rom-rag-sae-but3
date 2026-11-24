import { describe, expect, it } from 'vitest'
import { toCsv, type RomExportRow } from './rom-export.service.js'

const row: RomExportRow = {
  title: 'Tetris',
  fileName: 'Tetris (World).gb',
  relativePath: 'gb/Tetris (World).gb',
  platform: 'Nintendo - Game Boy',
  region: 'World',
  releaseYear: 1989,
  sizeBytes: 32768,
  identificationSource: 'DAT_SHA1',
  confidence: 1,
  md5: 'a'.repeat(32),
  sha1: 'b'.repeat(40),
}

// Tests for the CSV export, which must open cleanly in a spreadsheet
describe('toCsv', () => {
  it('writes a BOM, the header row and one CRLF-terminated line per ROM', () => {
    expect(toCsv([row])).toBe(
      '\uFEFFtitle,fileName,relativePath,platform,region,releaseYear,sizeBytes,identificationSource,confidence,md5,sha1\r\n' +
        `Tetris,Tetris (World).gb,gb/Tetris (World).gb,Nintendo - Game Boy,World,1989,32768,DAT_SHA1,1,${row.md5},${row.sha1}\r\n`,
    )
  })

  it('quotes a field holding a comma or a quote, and leaves null empty', () => {
    const line = toCsv([
      { ...row, title: 'Zelda, "Link"', region: null },
    ]).split('\r\n')[1]
    expect(line).toMatch(/^"Zelda, ""Link""",.*,Nintendo - Game Boy,,1989,/)
  })

  it('neutralizes a field a spreadsheet would run as a formula', () => {
    const line = toCsv([{ ...row, title: '=1+1' }]).split('\r\n')[1]
    expect(line?.startsWith("'=1+1,")).toBe(true)
  })
})
