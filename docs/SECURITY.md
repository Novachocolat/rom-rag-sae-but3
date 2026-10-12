<!-- 1 or 2 pages to describe what has been implemented to redure vulnerability, ensure security and data integrity -->

## Raw SQL

Prisma Client cannot read or write the `RomEmbedding.embedding` column
(`Unsupported("vector(768)")`, see ADR-007), so a few queries are written in
SQL. They all live in `backend/src/storage/embedding.storage.ts`, and nowhere
else.

- Queries are built with `Prisma.sql` / the `$executeRaw` and `$queryRaw` tagged
  templates: every value (ROM id, source text, model name, vector, `k`,
  threshold) is bound as a parameter, never concatenated into the statement.
- `$executeRawUnsafe` and `$queryRawUnsafe` are forbidden: interpolating a value
  into them is an SQL injection.
- A vector is serialized as the text literal `[0.1,0.2,...]` and passed as a
  parameter followed by `::vector`. Before that it is checked for the configured
  dimension and for non-finite values, so a malformed model answer fails instead
  of reaching the database.
- Similarity searches are scoped to the owner of the source ROM, so one user's
  library never surfaces in another's.
- A unit test (`embedding.storage.test.ts`) asserts that a hostile string ends
  up in the bound values and not in the SQL text.
