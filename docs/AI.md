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

## Models and roles

| Role       | Variable                 | Default          | Used for                                                          |
| ---------- | ------------------------ | ---------------- | ----------------------------------------------------------------- |
| Generation | `OLLAMA_LLM_MODEL`       | `gemma4:26b`     | ROM identification and grouping confirmation (`generateJson`)     |
| Embeddings | `OLLAMA_EMBEDDING_MODEL` | `embeddinggemma` | One vector per ROM, to find the candidates of a semantic grouping |

Every call goes through one module, `ollama-http.ts`: timeouts, retries and
error classification live there and nowhere else. `LlmClient` and
`EmbeddingClient` are the only interfaces the services know. `generateText`
exists on `LlmClient` but no feature uses it yet.

## Embedding dimension

`OLLAMA_EMBEDDING_DIM=768` is the output size of `embeddinggemma`. It is also
hard-wired in the schema: `RomEmbedding.embedding` is a `vector(768)` column
with an HNSW index (`vector_cosine_ops`), see ADR-010. Consequences:

- A model that outputs another size cannot be stored. The embedding client
  rejects the answer (`Embedding dimension mismatch`) and `upsertEmbedding`
  rejects the write, so a model swap fails loudly instead of corrupting the
  index.
- Changing the dimension is a schema change (new migration for the column and
  the index), not a configuration change.
- Vectors of two different models are not comparable, even at the same
  dimension. `RomEmbedding.model` records which model produced each vector.

## Context window and splitting

`OLLAMA_NUM_CTX` (4096 tokens by default) is sent as `num_ctx` on every
generation. A prompt that does not fit makes Ollama refuse the request, which is
mapped to `413 OLLAMA_CONTEXT_OVERFLOW` and never retried. Each feature keeps
its input small, then shrinks it if Ollama still refuses:

| Feature        | Normal size                                     | On `OLLAMA_CONTEXT_OVERFLOW`                                                       |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Identification | One ROM, at most 5 catalog candidates           | Nothing to shrink: the route answers `413`                                         |
| Grouping       | Chunks of at most 15 ROMs, sorted by base title | The chunk is halved and each half is sent alone; a pair that still fails is raised |
| Embeddings     | Batches of 32 texts per `/api/embed` call       | The batch is halved down to one text; a text that still fails is counted as failed |

Sorting by base title keeps the variants of one game in the same chunk, also
after a halving.

## Temperature

`OLLAMA_TEMPERATURE=0.1`. Both generations return structured data that is
checked and then compared to a threshold: the same input should give the same
answer, which also makes the cache meaningful. It is not 0, so that the model is
never forced onto a single greedy path that can loop. It applies to every call;
the `temperature` field in a prompt's front matter documents what the prompt was
tuned with.

## Thinking mode

- `generateJson` always sends `think: false`, whatever `OLLAMA_THINKING` says.
  Ollama applies the output grammar to the thinking channel too, and the
  reasoning ended up inside string fields of the JSON (for example in `region`).
- `generateText` sends `think: env.OLLAMA_THINKING`. The reasoning trace comes
  in a separate `thinking` field and is never mixed into `response`.

## Output schemas

The schema is converted with `z.toJSONSchema` and sent as Ollama's `format`
(constrained decoding), then the answer is validated again with the same Zod
schema.

| Schema                     | Used by        | Fields                                                                                                                                                          |
| -------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `romIdentificationSchema`  | Identification | `title`, `platform`, `region`, `publisher`, `genre` (nullable strings), `languages` (strings), `releaseYear` (nullable int), `confidence` (0 to 1), `reasoning` |
| `collectionGroupingSchema` | Grouping       | `sameGame`, `canonicalTitle`, `members[]` (`romId`, `variantLabel`, `belongs`), `confidence` (0 to 1), `reasoning`                                              |

## Failure modes

HTTP failures are produced by `ollama-http.ts` and are the same for every
feature. Retried means `OLLAMA_MAX_RETRIES` more attempts (2 by default), with
an exponential backoff of 250 ms, 500 ms, ... each lengthened by up to 100%
random jitter. Every scenario is covered end to end, from the route down to a
simulated Ollama, by `backend/src/client/ollama/ollama-resilience.test.ts`.

| Scenario                                      | Behaviour                                                                                                           | Answer                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Ollama unreachable (`ECONNREFUSED`, 502, 503) | Retried, then given up. The rest of the application keeps working                                                   | `503 OLLAMA_UNAVAILABLE`                      |
| Server error (other 5xx)                      | Retried                                                                                                             | `502 OLLAMA_SERVER_ERROR`                     |
| Timeout (`OLLAMA_TIMEOUT_MS`)                 | Not retried: the inference already ran once                                                                         | `504 OLLAMA_TIMEOUT`                          |
| Malformed JSON                                | Not retried. The raw output is in `error.details.raw` and in the logs. No proposal is created                       | `502 OLLAMA_INVALID_JSON`                     |
| Empty response                                | Same as malformed JSON, `raw` is empty                                                                              | `502 OLLAMA_INVALID_JSON`                     |
| Valid JSON, refused by Zod                    | Same, `error.details.issues` lists what is wrong. No proposal is created                                            | `502 OLLAMA_INVALID_JSON`                     |
| Model not pulled (404)                        | Not retried. The message names the model and the `ollama pull` to run                                               | `503 OLLAMA_MODEL_NOT_FOUND`                  |
| Context overflow                              | Not retried. Grouping and embeddings halve the batch (see above)                                                    | `413 OLLAMA_CONTEXT_OVERFLOW`                 |
| `/api/embed` in its legacy form               | The singular `embedding` is read as well as `embeddings`                                                            | Transparent                                   |
| Ollama cut during an identification batch     | The batch stops at the first unreachable or timed-out ROM instead of failing each one                               | Job ends, no HTTP status                      |
| Ollama cut during an embeddings backfill      | The run stops at the first unreachable batch. That batch is counted as failed, the vectors already written are kept | Observable on `GET /api/ai/embeddings/status` |
| Ollama cut during a collection detection      | The collections of stages 1 and 2 are kept, the semantic stage is skipped                                           | Job ends normally                             |

Jobs live in memory (ADR-012) and have no `FAILED` status: what a job did is
read from the data. After an interrupted backfill,
`GET /api/ai/embeddings/status` gives `{ total, embedded, missing }`, and
starting the backfill again only vectorizes the ROMs that still have no vector.

## Cache

Only identifications are cached, in Redis under `ai:identification:<sha256>`.
The hash covers the model, the prompt name, the prompt version and the rendered
prompt, so changing any of them is a miss. The TTL is `AI_CACHE_TTL_SECONDS` (24
hours by default).

- The entry is the raw model answer, not the decision: a hit goes through the
  same coherence checks and the same threshold as a fresh answer.
- An entry is written only after a valid answer, so a failure is never cached.
- A corrupt or outdated entry counts as a miss.

## Changing a model

**Generation model.** Set `OLLAMA_LLM_MODEL` (and the `model` of the prompts'
front matter), then restart the backend. Nothing else is needed: the model is
part of the cache key, and existing proposals keep the model that produced them.
Pull it first on the Ollama instance, otherwise every call answers
`503 OLLAMA_MODEL_NOT_FOUND`.

**Embedding model.** The existing vectors become meaningless, so every ROM must
be vectorized again. The backfill only handles ROMs without a vector, so the old
ones have to be removed first.

1. Pull the new model and set `OLLAMA_EMBEDDING_MODEL`.
2. If its dimension is not 768, set `OLLAMA_EMBEDDING_DIM`, then write a
   migration that changes the `vector(768)` column and recreates the HNSW index.
   Without it, every write is rejected.
3. Restart the backend (`docker compose up -d --force-recreate backend`).
4. Delete the old vectors:

   ```sh
   docker compose exec postgres psql -U postgres -d app \
     -c 'DELETE FROM "RomEmbedding" WHERE model <> '"'"'<new model>'"'"';'
   ```

5. Start the backfill (`POST /api/ai/embeddings/backfill`) and follow it on
   `GET /api/ai/embeddings/status` until `missing` is 0.

Until step 5 is over, the semantic stage of collection detection only sees the
ROMs that already have a vector. Catalog families and base titles are not
affected.
