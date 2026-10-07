# AI identification

ROMs that no DAT catalog identifies can be sent to the Ollama LLM. The model
proposes a title, platform, region and other metadata. A proposal is never
written into the ROM: it waits in a review queue until a user accepts it.

## Pipeline

1. **Context.** The file name, extension, size, a platform deduced from the ROM
   or its extension, and up to 5 closest catalog names (`findCandidateEntries`).
2. **Prompt.** `prompts/identification.v1.md` is rendered with that context.
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

| Method | Path                           | Behaviour                                                              |
| ------ | ------------------------------ | ---------------------------------------------------------------------- |
| POST   | `/api/ai/roms/:id/identify`    | Identifies one ROM, answers `200` with the proposal                    |
| POST   | `/api/ai/roms/identify-batch`  | Identifies every `UNIDENTIFIED` ROM in a background job, answers `202` |
| GET    | `/api/ai/proposals`            | Paginated review queue, `status` defaults to `PENDING`                 |
| POST   | `/api/ai/proposals/:id/review` | `{ action: 'accept' \| 'reject', corrections? }`                       |

When Ollama is unreachable, the single-ROM route answers
`503 OLLAMA_UNAVAILABLE` and the batch stops early.
