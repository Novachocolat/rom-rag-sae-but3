# Data model

**Source of truth:
[`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).** This
document is written by hand from that file and must be updated in the same PR
whenever the schema changes (see
[US1.6](./monitoring/sprint-01.md#us16--dette-documentaire-et-outillage)).

## Entity-relationship diagram

Only keys, relations and the columns the pipeline relies on are shown; see the
schema for every field.

```mermaid
erDiagram
    User ||--o{ Rom : owns
    User ||--o{ Collection : owns
    User ||--o{ ScanJob : starts
    User |o--o{ AiProposal : reviews
    Platform ||--o{ DatFile : catalogs
    Platform |o--o{ Rom : runs
    Platform |o--o{ Collection : groups
    DatFile ||--|{ DatEntry : contains
    DatEntry |o--o{ Rom : identifies
    Rom ||--o{ AiProposal : "is proposed for"
    Collection |o--o{ AiProposal : "is proposed for"
    Collection ||--o{ CollectionMember : has
    Rom ||--o{ CollectionMember : "belongs to"
    Rom ||--o| RomEmbedding : "is embedded as"

    User {
        uuid id PK
        string email UK "lowercased"
        string passwordHash "Argon2id, never returned"
        string displayName "nullable"
    }
    Platform {
        uuid id PK
        string slug UK "e.g. nintendo-game-boy"
        string name
        string_array extensions "e.g. .gb"
    }
    DatFile {
        uuid id PK
        uuid platformId FK
        string headerName
        string version
        int entryCount
        string contentSha1 UK "blocks a duplicate import"
    }
    DatEntry {
        uuid id PK
        uuid datFileId FK
        string gameName
        string romName
        string normalizedName "baseTitle, for DAT_NAME"
        bigint sizeBytes
        string md5 "indexed, lowercase"
        string sha1 "indexed, lowercase"
        string cloneOfId "nullable"
    }
    Rom {
        uuid id PK
        uuid userId FK
        string relativePath "POSIX, relative to ROM_LIBRARY_ROOT"
        string md5
        string sha1
        string md5Data "nullable, header skipped"
        string sha1Data "nullable, header skipped"
        int headerBytesSkipped "0, 16 or 512"
        uuid platformId FK "nullable, from magic bytes"
        uuid datEntryId FK "nullable"
        enum identificationSource
        float confidence "nullable"
        datetime lastScannedAt "bumped by every rescan"
    }
    AiProposal {
        uuid id PK
        enum kind
        uuid romId FK "nullable"
        uuid collectionId FK "nullable"
        json payload
        string rawResponse "nullable"
        string promptVersion
        float confidence
        enum status
    }
    Collection {
        uuid id PK
        uuid userId FK
        string canonicalTitle
        enum source
    }
    CollectionMember {
        uuid collectionId PK, FK
        uuid romId PK, FK
        string variantLabel "nullable, e.g. France"
    }
    RomEmbedding {
        uuid romId PK, FK
        string sourceText
        vector embedding "vector(768)"
    }
    ScanJob {
        uuid id PK
        uuid userId FK
        string rootRelativePath
        enum status
        int totalFiles
        int processedFiles
        int errorCount
    }
```

## Enums

- **`IdentificationSource`** (`Rom.identificationSource`) records how a ROM got
  its metadata, from the strongest proof to the weakest:
  - `DAT_SHA1` / `DAT_MD5`: the whole file matches a `DatEntry` hash;
  - `DAT_SHA1_DATA` / `DAT_MD5_DATA`: the file matches once its copier/iNES
    header is skipped (`headerBytesSkipped`), so it is the right game with a
    different header;
  - `DAT_NAME`: the normalized file name matches exactly one `DatEntry` of the
    same extension (no hash match);
  - `AI_PROPOSED`: an `AiProposal` is pending;
  - `USER_CONFIRMED`: a human validated an AI proposal;
  - `UNIDENTIFIED`: no match, no proposal yet.
- **`AiProposalKind`** (`AiProposal.kind`) with `IDENTIFICATION` (metadata guess
  for one `Rom`) vs `GROUPING` (variants of the same game should form one
  `Collection`). The kind determines whether `romId` or `collectionId` is set.
- **`AiProposalStatus`** (`AiProposal.status`) is set to `PENDING` until a user
  reviews it (`reviewedAt`/`reviewedById` set), then `ACCEPTED` or `REJECTED`.
  An accepted `GROUPING` proposal is what creates/extends a `Collection`.
- **`CollectionSource`** (`Collection.source`) means how the collection was
  formed: `DAT_CLONE` (the DAT file already lists variants via `cloneOfId`),
  `AI` (from an accepted `GROUPING` proposal, see
  [ADR-010](./adr/010-embeddinggemma-vectors-in-pgvector-for-semantic-grouping.md)),
  or `MANUAL` (user-created).
- **`ScanJobStatus`** (`ScanJob.status`) is the lifecycle of a directory scan:
  `PENDING` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED`. See
  [ADR-012](./adr/012-in-process-job-with-redis-progress-no-bullmq.md) for how
  progress is tracked and polled.

## Notes

- `RomEmbedding.embedding` is `Unsupported("vector(768)")`: Prisma has no native
  type for a `pgvector` column, so its HNSW index is created by a hand-written
  migration and all similarity queries go through typed `$queryRaw` helpers (see
  [ADR-007](./adr/007-postgresql-with-pgvector-as-the-vector-store.md) and
  [ADR-010](./adr/010-embeddinggemma-vectors-in-pgvector-for-semantic-grouping.md)).
- `Rom` is unique on `(userId, relativePath)`: the same physical file path can
  only exist once per user's library, but the same ROM (by hash) can appear
  under different paths or different users. A rescan upserts on this key, so it
  never duplicates a row and only moves `lastScannedAt` (`@updatedAt`).
- `Rom.relativePath` and `ScanJob.rootRelativePath` are always relative to
  `ROM_LIBRARY_ROOT` and use POSIX separators (`/`), so the same library gives
  the same rows on Windows and Linux. No absolute path is ever stored.
- `Rom.platformId` is set by the scan from the extension and the magic bytes
  (`detectPlatformSlug` in `backend/src/service/rom-file.service.ts`), mapped to
  the platforms seeded by `backend/prisma/seed.ts`.
- `DatEntry.normalizedName` is the `baseTitle` of the game name
  (`backend/src/service/title-normalizer.service.ts`), filled at import: a
  catalog imported before this column existed must be re-imported.
- `ScanJob` is the durable record of a scan; its live progress lives in Redis
  under `scan:<jobId>` for 6 hours, then the API falls back to this row.
- `AiProposal.romId` and `AiProposal.collectionId` are both nullable because a
  proposal targets exactly one of the two, depending on `kind`.
