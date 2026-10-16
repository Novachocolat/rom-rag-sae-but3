# AI identification

ROMs that no DAT catalog identifies can be sent to the Ollama LLM. The model
proposes a title, platform, region and other metadata. A proposal is never
written into the ROM: it waits in a review queue until a user accepts it.

## Pipeline

1. **Context.** The file name, extension, size, a platform deduced from the ROM
   or its extension, and up to 5 closest catalog names (`findCandidateEntries`).
2. **Prompt.** `prompts/identification.v2.md` is rendered with that context.
   Prompts are versioned files, never strings inside `.ts`.
3. **Model call.** `generateJson` sends the schema derived from
   `romIdentificationSchema` as the Ollama `format`, so the output is
   constrained and then validated again.
4. **Cache.** Redis key `ai:identification:<sha256>`, where the hash covers the
   model, prompt name, prompt version and rendered prompt. Changing any of them
   invalidates the entry. TTL is `AI_CACHE_TTL_SECONDS`.
5. **Coherence checks.** Rejected on any of these:
   - no title, or a title longer than 200 characters;
   - a platform absent from the catalog, or one that does not use the file
     extension;
   - a release year outside 1970 to the current year;
   - a language code the app does not know.
6. **Plausibility.** If the title exists in an imported catalog, confidence
   rises by 0.1 (capped at 1).
7. **Threshold.** A coherent proposal at or above `AI_CONFIDENCE_THRESHOLD`
   becomes `PENDING`. Below it, the proposal is stored as `REJECTED` with
   `lowConfidence: true`. Rejected proposals are kept for audit.

## Review

- An accept promotes the ROM to `USER_CONFIRMED` in the same transaction that
  marks the proposal `ACCEPTED`. Corrections go through the same coherence
  checks as the model's answer.
- A reject only changes the proposal status.
- A ROM already identified by a catalog, or one with a pending proposal, cannot
  be identified again.

## Endpoints

| Method | Path                           | Behaviour                                                                                                     |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/ai/roms/:id/identify`    | Identifies one ROM, answers `200` with the proposal                                                           |
| POST   | `/api/ai/roms/identify-batch`  | Identifies every `UNIDENTIFIED` ROM in a background job, answers `202`                                        |
| GET    | `/api/ai/proposals`            | Paginated review queue, `status` defaults to `PENDING`; `romId` plus `status=ALL` give the history of one ROM |
| POST   | `/api/ai/proposals/:id/review` | `{ action: 'accept' \| 'reject', corrections? }`                                                              |

When Ollama is unreachable, the single-ROM route answers
`503 OLLAMA_UNAVAILABLE` and the batch stops early.

## Interface

- The header status follows `GET /api/health`, polled every 10 seconds and on
  window focus. It turns red or green without a page reload.
- Any action that needs an inference uses `AiButton`: while Ollama is down it is
  disabled and its tooltip says why. Accepting or rejecting a proposal needs no
  inference and stays available.
- `GET /api/roms/:id` feeds the ROM detail page: whole-file and data-only
  fingerprints, `headerBytesSkipped`, the matched DAT entry, and the proposal
  history.
- A proposal exposes `reviewedAt`. A `REJECTED` proposal with a null
  `reviewedAt` was discarded automatically, never by a user.

## Collections and duplicates

`POST /api/collections/detect` groups the ROMs that are in no collection yet, in
three stages. Each stage only sees what the previous one left over.

1. **Catalog family** (`DAT_CLONE`, confidence 1). ROMs of one DAT family on a
   platform: a parent and its clones, or clones of the same parent even when the
   parent is not in the library. No model involved.
2. **Base title** (`DAT_CLONE`, confidence 0.95). ROMs sharing a platform and a
   non-empty normalized title. No model involved.
3. **Semantic** (`AI`). The remaining ROMs are linked when the cosine similarity
   of their vectors reaches 0.85, which needs the embeddings backfill. Each
   cluster is sent to the model with `prompts/grouping.v1.md`, at most 15 ROMs
   per call. The model confirms the cluster, removes intruders, or refuses it.

The model's answer is never trusted as is:

- an id that was not in the prompt is dropped and reported in `issues`;
- a ROM the model leaves out, or marks as not belonging, is removed;
- fewer than two ROMs left, or no title, creates nothing;
- confidence below `AI_CONFIDENCE_THRESHOLD` creates nothing.

Every answer is stored as an `AiProposal` of kind `GROUPING`, with the raw
response, the model, the prompt version and the inference metrics. A confident
one creates the collection and stays `PENDING`, linked to it: keeping the
collection confirms it, dissolving it closes the proposal as `REJECTED`. The
others are stored as `REJECTED`, for audit. These proposals are not listed by
`GET /api/ai/proposals`, which only returns identifications.

Exact copies of a file count once: one copy can join a collection, the others
are only reported as duplicates. When Ollama is unreachable, stages 1 and 2 are
saved and stage 3 is skipped.

| Method | Path                          | Behaviour                                                                                      |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| POST   | `/api/collections/detect`     | Starts the detection as a background job, answers `202`; `409` while one is running            |
| GET    | `/api/collections`            | Paginated list with member counts                                                              |
| GET    | `/api/collections/duplicates` | Exact duplicates (same SHA-1) and header duplicates (same data, different header)              |
| GET    | `/api/collections/:id`        | Members and their pairwise similarity                                                          |
| POST   | `/api/collections`            | Manual creation: `{ canonicalTitle, platformId?, romIds? }`                                    |
| PATCH  | `/api/collections/:id`        | `{ canonicalTitle?, addRomIds?, removeRomIds? }`, applied all or nothing                       |
| POST   | `/api/collections/:id/merge`  | `{ sourceId }`: moves the members of the source into the collection, then dissolves the source |
| DELETE | `/api/collections/:id`        | Dissolves the collection, keeps the ROMs                                                       |
