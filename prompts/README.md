# Prompts

This directory holds the versioned prompts the backend loads at startup via
`prompt-loader.service.ts`. Treat a prompt change like a code change: it goes
through a PR (see
[CONVENTIONS.md](../CONVENTIONS.md#dataset-and-prompts-hygiene)).

## File format

Each prompt is a single Markdown file named `<name>.v<version>.md`. It starts
with a YAML front-matter header:

```yaml
---
name: identification
version: v1
model: gemma3:27b
temperature: 0.1
description: One-line summary of what this prompt is for.
changelog:
  - v1: initial version
---
```

- `name` — logical prompt name, used to call `renderPrompt(name, vars)`.
- `version` — matches the version in the file name (`v1`, `v2`, ...).
- `model` — the Ollama model this prompt was written and tuned for.
- `temperature` — the sampling temperature to use with this prompt.
- `description` — short, one-line summary.
- `changelog` — one entry per version, oldest first.

The body contains the system message and the user template, each under a
`# System` / `# User` heading. The user template may reference variables with
`{{variableName}}`; `prompt-loader.service.ts` performs a literal `{{key}}`
substitution (no templating engine) and throws if a variable used in the
template is not provided.

Common variables:

- `{{romFileName}}` — the file name (or normalized title, depending on the
  prompt).
- `{{platformName}}` — the platform guessed or confirmed for the file.
- `{{fileSize}}` — file size in bytes.
- `{{candidates}}` — a short, pre-formatted list of nearby catalog entries or
  collections, built by the caller before rendering the prompt.

## Writing rules

- **Do not describe the JSON output format in the prompt.** That's the job of
  the `format` parameter passed to the Ollama API (a JSON schema), not of the
  prompt text. The prompt describes the task and the decision rules, not the
  response shape.
- **Always allow the model to admit it doesn't know.** Every prompt must
  explicitly instruct the model to lower `confidence` and return `null` for the
  identifying field (`title`, `collectionId`, ...) when it isn't sure, rather
  than guessing. A model that isn't allowed to say "I don't know" hallucinates —
  this instruction is the main hallucination-filtering mechanism this project
  relies on.
- **Ground the response in the available context.** Pass whatever is known (file
  extension, size, guessed platform, nearby DAT candidates) so the model reasons
  from evidence rather than from the file name alone.
- **Always request a short `reasoning` field.** It is shown to the user so they
  can judge the proposal themselves instead of trusting a bare confidence
  number.

## Models

See [identification.v1.md](./identification.v1.md),
[grouping.v1.md](./grouping.v1.md) and [summary.v1.md](./summary.v1.md).
