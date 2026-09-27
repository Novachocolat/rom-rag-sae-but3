import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parseDatXml } from './dat-parser.service.js'

// Fixture to test a .dat file
const DAT_FILE_FIXTURE = `<?xml version="1.0"?>
<datafile>
  <header>
    <name>Sega - Mega Drive - Genesis</name>
    <version>20260914-071043</version>
  </header>
  <game name="Sonic &amp; Knuckles (World)" id="1200">
    <category>Games</category>
    <rom name="Sonic &amp; Knuckles (World).md" size="2097152" crc="1234ABCD" md5="ABCDEF0123456789ABCDEF0123456789" sha1="ABCDEF0123456789ABCDEF0123456789ABCDEF0" sha256="ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF01234567" status="verified"/>
  </game>
  <game name="Multi Category Game" id="1201">
    <category>Games</category>
    <category>Demos</category>
    <rom name="Multi Category Game.md" size="524288" crc="AAAAAAAA"/>
  </game>
  <game name="No Category Game" id="1202">
    <rom name="No Category Game.md" size="131072" crc="BBBBBBBB"/>
  </game>
  <game name="Clone Game" id="1203" cloneofid="0004">
    <rom name="Clone Game.md" size="65536" crc="CCCCCCCC"/>
  </game>
  <game name="Multi ROM Game" id="1204">
    <rom name="Multi ROM Game (Disk 1).md" size="1048576" crc="DDDDDDDD"/>
    <rom name="Multi ROM Game (Disk 2).md" size="1048576" crc="EEEEEEEE"/>
  </game>
  <game name="Oversized ROM" id="1205">
    <rom name="Oversized.md" size="9007199254741000" crc="FFFFFFFF"/>
  </game>
</datafile>`

// Tests for the pure .dat XML parser
describe('parseDatXml', () => {
  it('must extract the header as-is', () => {
    const { header } = parseDatXml(DAT_FILE_FIXTURE)

    expect(header).toEqual({
      name: 'Sega - Mega Drive - Genesis',
      version: '20260914-071043',
    })
  })

  it('must decode XML entities in <game> and <rom> names (Sonic &amp; Knuckles)', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const sonic = entries.find((game) => game.id === '1200')

    expect(sonic?.name).toBe('Sonic & Knuckles (World)')
    expect(sonic?.rom[0]?.name).toBe('Sonic & Knuckles (World).md')
  })

  it('must normalize a lone <rom> into a one-item array', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const sonic = entries.find((game) => game.id === '1200')

    expect(Array.isArray(sonic?.rom)).toBe(true)
    expect(sonic?.rom).toHaveLength(1)
  })

  it('must keep every <rom> when a <game> declares more than one', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const multiRom = entries.find((game) => game.id === '1204')

    expect(multiRom?.rom).toHaveLength(2)
    expect(multiRom?.rom.map((rom) => rom.name)).toEqual([
      'Multi ROM Game (Disk 1).md',
      'Multi ROM Game (Disk 2).md',
    ])
  })

  it('must normalize repeated <category> tags into a string array', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const multiCategory = entries.find((game) => game.id === '1201')

    expect(multiCategory?.category).toEqual(['Games', 'Demos'])
  })

  it('must default category to an empty array when the tag is absent', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const noCategory = entries.find((game) => game.id === '1202')

    expect(noCategory?.category).toEqual([])
  })

  it('must keep cloneofid as a string, not a number', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const clone = entries.find((game) => game.id === '1203')

    expect(clone?.cloneofid).toBe('0004')
    expect(typeof clone?.cloneofid).toBe('string')
  })

  it('must leave cloneofid undefined for a game that is not a clone', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const original = entries.find((game) => game.id === '1202')

    expect(original?.cloneofid).toBeUndefined()
  })

  it('must convert an oversized size into a BigInt beyond Number.MAX_SAFE_INTEGER', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const oversized = entries.find((game) => game.id === '1205')
    const rom = oversized?.rom[0]

    expect(typeof rom?.size).toBe('bigint')
    expect(rom?.size).toBe(9007199254741000n)
    expect(rom?.size).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER))
  })

  it('must normalize every hash to lowercase regardless of the XML casing', () => {
    const { entries } = parseDatXml(DAT_FILE_FIXTURE)
    const sonic = entries.find((game) => game.id === '1200')
    const rom = sonic?.rom[0]

    expect(rom?.crc).toBe('1234abcd')
    expect(rom?.md5).toBe('abcdef0123456789abcdef0123456789')
    expect(rom?.sha1).toBe('abcdef0123456789abcdef0123456789abcdef0')
    expect(rom?.sha256).toBe(
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567',
    )
  })

  // Zod errors handling
  it('must throw a clear ZodError when the header is missing (malformed .dat)', () => {
    const malformed = `<datafile><game id="1" name="a"><rom name="a.md" size="1"/></game></datafile>`

    expect(() => parseDatXml(malformed)).toThrow(z.ZodError)
  })

  it('must throw a clear ZodError when a rom has no name', () => {
    const malformed = `<datafile><header><name>Test</name></header><game id="1" name="a"><rom size="1"/></game></datafile>`

    expect(() => parseDatXml(malformed)).toThrow(z.ZodError)
  })

  it('must throw a clear ZodError when a rom size is not numeric', () => {
    const malformed = `<datafile><header><name>Test</name></header><game id="1" name="a"><rom name="a.md" size="not-a-number"/></game></datafile>`

    expect(() => parseDatXml(malformed)).toThrow(z.ZodError)
  })

  it('must throw a clear ZodError on content that is not XML at all', () => {
    expect(() => parseDatXml('this is not xml at all')).toThrow(z.ZodError)
  })
})
