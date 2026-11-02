# Dataset

Test material for the scanner, the catalog identification, the grouping and the
AI identification. `node scripts/check-dataset.mjs` prints how every file
matches the catalogs; run it after any change here.

## Legal origin

The dumps come from legally acquired cartridges owned by the university. One exception for `tobudx.gb`, which is a **homebrew game**, available on **itch.io** (https://tangramgames.itch.io/tobu-tobu-girl-deluxe).

Files under `unknown/` are derived from ROMs of this dataset. Same cartridges, so same origin.

## Catalogs (`dat/`)

Seven No-Intro catalogs (Logiqx XML), imported automatically by
`npm run db:seed`. Download settings: see
[CONTRIBUTING.md](../CONTRIBUTING.md#dat-o-matic-configuration).

## ROMs (`roms/`)

| File | Expected identification | Demonstrates |
| --- | --- | --- |
| `gb/`, `gbc/`, `gba/`, `megadrive/` (20 files) | `DAT_SHA1` | deterministic identification |
| `nes/*.nes` (5 files) | `DAT_SHA1_DATA`, 16-byte iNES header skipped | identification by data hash |
| `snes/Super_Mario_Kart.sfc` | `DAT_SHA1_DATA`, 512-byte copier header skipped | identification by data hash |
| other `snes/*.sfc` (4 files) | `DAT_SHA1` | deterministic identification |
| `gb/duplicates/Tetris_(copy).gb` | `DAT_SHA1`, same SHA-1 as `gb/Tetris.gb` | `EXACT_DUPLICATE` detection |
| `nes/broken/Empty.nes` | none (0 bytes) | scan error handling |
| `snes/broken/F-Zero_(truncated).sfc` | none (first 64 KiB only) | scan error handling |
| `gb/Pokemon_-_Red_Version.gb` + `gb/Pokemon_-_Version_Rouge.gb` | parent 1038 and its clone | grouping without AI (`DAT_CLONE`) |
| `gba/unknown/WarioLand4_(trimmed).gba` | none: trailing padding removed | AI identification |
| `gbc/unknown/Zelda_OoA_(overdump).gbc` | none: cartridge read twice | AI identification, anchored by catalog candidates |

Sub-folders (`duplicates/`, `broken/`, `unknown/`) exercise the recursive walk.

> `tobudx.gb` is a homebrew game for Game Boy, available on **itch.io** here: https://tangramgames.itch.io/tobu-tobu-girl-deluxe.

### Two traps

- **The three French Pokémon (Rouge, Bleue, Jaune) are three different games**,
  with three catalog parents (1038, 1035, 1571). Neither `cloneofid` nor the
  normalized title groups them: they illustrate semantic neighbours,
  not grouping without AI.
- **Renaming a ROM does not make it unknown**: identification checks the
  hash first. A file meant for the AI needs a content absent from every catalog
  *and* a name whose normalized title matches no catalog entry (otherwise it
  is identified as `DAT_NAME`).

## Adding a binary file without corrupting it

Five files have already been lost to a text decoding: a tool read the ROM as
text (UTF-8 or line endings), which rewrites every byte above `0x7F` or every `0x0A`, so the SHA-1 no longer matches any catalog. `.gitattributes` marks `dataset/roms/**` as `binary`; `git ls-files --eol dataset/roms` must show `i/-text` for every ROM.
