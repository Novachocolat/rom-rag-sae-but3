import { fileURLToPath } from 'node:url'
import swaggerJsdoc from 'swagger-jsdoc'
import { z } from 'zod'
import {
  aiProposalSchema,
  aiProposalStatusSchema,
  apiErrorSchema,
  collectionAcceptSchema,
  collectionCreateSchema,
  collectionDetailSchema,
  collectionListSchema,
  collectionMemberSchema,
  collectionMergeSchema,
  collectionProposalListSchema,
  collectionProposalSchema,
  collectionSourceSchema,
  collectionSummarySchema,
  collectionUpdateSchema,
  createPaginatedResponseSchema,
  dependencyStatusSchema,
  duplicateGroupSchema,
  healthSchema,
  identificationSourceSchema,
  inferenceStatsSchema,
  loginSchema,
  memberSimilaritySchema,
  metricsSchema,
  modelMetricsSchema,
  paginationSchema,
  platformSchema,
  proposalCorrectionsSchema,
  proposalReviewSchema,
  publicUserSchema,
  romDatEntrySchema,
  romDetailSchema,
  romIdentificationSchema,
  romSummarySchema,
  scanJobSummarySchema,
  scanProgressSchema,
  scanRequestSchema,
  scanStatusSchema,
  signupSchema,
} from '@repo/shared/schemas'
import { env } from '../env.js'

/**
 * Response shapes the shared package does not define: they mirror what the
 * routes answer, so keep them in sync with the matching handler.
 */

// A row of GET /api/dat: a Prisma DatFile with its platform
const datFileSchema = z.object({
  id: z.uuid(),
  platformId: z.uuid(),
  headerName: z.string(),
  version: z.string().nullable(),
  fileName: z.string(),
  entryCount: z.number().int(),
  importedAt: z.iso.datetime(),
  contentSha1: z.string(),
  platform: z.object({ slug: z.string(), name: z.string() }),
})

// Body of POST /api/dat/import (mirrors `importBodySchema` of dat.routes.ts)
const datImportRequestSchema = z.object({
  fileName: z.string().min(1),
})

// Answer of POST /api/dat/import
const datImportResultSchema = z.object({
  datFile: datFileSchema.omit({ platform: true }),
  insertedEntries: z.number().int().nonnegative(),
})

// Answer of GET /api/library/browse
const libraryBrowseSchema = z.object({
  path: z.string(),
  directories: z.array(z.string()),
})

// Answer of every route that starts a background job (202)
const jobAcceptedSchema = z.object({ jobId: z.uuid() })

// Answer of GET /api/ai/embeddings/status (mirrors `EmbeddingStatus` of embedding.service.ts)
const embeddingStatusSchema = z.object({
  total: z.number().int().nonnegative(),
  embedded: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
})

// Answer of POST /api/ai/proposals/:id/review
const proposalReviewResultSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
})

// Answer of POST /api/collections (201)
const collectionCreatedSchema = z.object({
  id: z.uuid(),
  canonicalTitle: z.string(),
  memberCount: z.number().int().nonnegative(),
})

// Answer of GET /api/collections/duplicates
const duplicateListSchema = z.object({
  duplicates: z.array(duplicateGroupSchema),
})

/*
 * Every schema below becomes `#/components/schemas/<id>`. A schema nested in
 * another registered one is emitted as a `$ref` instead of being inlined, which
 * is what lets the routes and the schemas share the same objects.
 */
const registry = z.registry<{ id: string }>()
const components: Record<string, z.ZodType> = {
  // Common
  ApiError: apiErrorSchema,
  Pagination: paginationSchema,
  JobAccepted: jobAcceptedSchema,
  // Health
  DependencyStatus: dependencyStatusSchema,
  Health: healthSchema,
  // Auth
  SignupRequest: signupSchema,
  LoginRequest: loginSchema,
  PublicUser: publicUserSchema,
  // DAT
  Platform: platformSchema,
  DatFile: datFileSchema,
  DatImportRequest: datImportRequestSchema,
  DatImportResult: datImportResultSchema,
  // Library and scans
  LibraryBrowse: libraryBrowseSchema,
  ScanRequest: scanRequestSchema,
  ScanStatus: scanStatusSchema,
  ScanProgress: scanProgressSchema,
  ScanJobSummary: scanJobSummarySchema,
  ScanJobPage: createPaginatedResponseSchema(scanJobSummarySchema),
  // ROMs
  IdentificationSource: identificationSourceSchema,
  RomSummary: romSummarySchema,
  RomDatEntry: romDatEntrySchema,
  RomDetail: romDetailSchema,
  RomPage: createPaginatedResponseSchema(romSummarySchema),
  // AI
  RomIdentification: romIdentificationSchema,
  InferenceStats: inferenceStatsSchema,
  AiProposalStatus: aiProposalStatusSchema,
  AiProposal: aiProposalSchema,
  AiProposalPage: createPaginatedResponseSchema(aiProposalSchema),
  ProposalCorrections: proposalCorrectionsSchema,
  ProposalReviewRequest: proposalReviewSchema,
  ProposalReviewResult: proposalReviewResultSchema,
  EmbeddingStatus: embeddingStatusSchema,
  // Collections
  CollectionSource: collectionSourceSchema,
  CollectionSummary: collectionSummarySchema,
  CollectionPage: collectionListSchema,
  CollectionMember: collectionMemberSchema,
  MemberSimilarity: memberSimilaritySchema,
  CollectionDetail: collectionDetailSchema,
  CollectionProposal: collectionProposalSchema,
  CollectionProposalPage: collectionProposalListSchema,
  DuplicateGroup: duplicateGroupSchema,
  DuplicateList: duplicateListSchema,
  CollectionCreateRequest: collectionCreateSchema,
  CollectionCreated: collectionCreatedSchema,
  CollectionUpdateRequest: collectionUpdateSchema,
  CollectionMergeRequest: collectionMergeSchema,
  CollectionAcceptRequest: collectionAcceptSchema,
  // Metrics
  ModelMetrics: modelMetricsSchema,
  Metrics: metricsSchema,
}
for (const [id, schema] of Object.entries(components)) {
  registry.add(schema, { id })
}

/**
 * Converts the registry to OpenAPI 3.1 component schemas (JSON Schema 2020-12)
 * so the documentation never drifts from the Zod validation.
 * `io: 'input'` documents what a client sends: a field with a default is optional.
 */
function buildComponentSchemas(): Record<string, swaggerJsdoc.Schema> {
  const { schemas } = z.toJSONSchema(registry, {
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
    override: (ctx) => {
      // Dates are sent as ISO strings over JSON
      if (ctx.zodSchema._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string'
        ctx.jsonSchema.format = 'date-time'
      }
    },
  })

  // `$schema` and `$id` are standalone JSON Schema keys, noise inside an OpenAPI document
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _s, $id: _i, ...schema }]) => [
      id,
      schema as swaggerJsdoc.Schema,
    ]),
  )
}

// Error answer shared by every 4xx/5xx response below
const errorContent = {
  'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
}

// Route files carrying the `@openapi` blocks. POSIX separators: glob reads `\` as an escape
const ROUTES_GLOB = `${fileURLToPath(new URL('../routes/', import.meta.url)).replaceAll('\\', '/')}*.routes.{ts,js}`

// Minimal typing of the generated document, enough for the routes and the tests
export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, Record<string, unknown>>
  components: {
    schemas: Record<string, unknown>
    responses: Record<string, unknown>
    parameters: Record<string, unknown>
    securitySchemes: Record<string, unknown>
  }
}

// OpenAPI document built from the components above and the `@openapi` blocks of the route files
export const openapiSpec = swaggerJsdoc({
  failOnErrors: true, // A malformed `@openapi` block throws instead of being skipped silently
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'ROM RAG BUT3 API',
      version: '0.0.0',
      description:
        'Every route is mounted under `/api`. Authenticated routes read the session cookie set by `/auth/login` or `/auth/signup`.',
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'Health' },
      { name: 'Auth' },
      { name: 'DAT' },
      { name: 'Library' },
      { name: 'Scans' },
      { name: 'ROMs' },
      { name: 'AI' },
      { name: 'Collections' },
      { name: 'Metrics' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: env.SESSION_COOKIE_NAME,
        },
      },
      schemas: buildComponentSchemas(),
      parameters: {
        IdPath: {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        Page: {
          in: 'query',
          name: 'page',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        PageSize: {
          in: 'query',
          name: 'pageSize',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      responses: {
        BadRequest: {
          description: 'Invalid parameters or body (VALIDATION_ERROR)',
          content: errorContent,
        },
        Unauthorized: {
          description: 'Missing or expired session (UNAUTHENTICATED)',
          content: errorContent,
        },
        NotFound: {
          description: 'Resource not found, or owned by another user',
          content: errorContent,
        },
        Conflict: {
          description: 'The resource state forbids the operation',
          content: errorContent,
        },
        OllamaError: {
          description:
            'Ollama is unreachable (503), timed out (504) or answered something unusable (502)',
          content: errorContent,
        },
      },
    },
  },
  apis: [ROUTES_GLOB],
}) as OpenApiDocument
