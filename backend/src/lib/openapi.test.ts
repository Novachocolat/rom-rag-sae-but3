import { describe, expect, it } from 'vitest'
import { rootRouter } from '../routes/index.js'
import { openapiSpec } from './openapi.js'

// Minimal view of an Express 5 router layer: a route, or a nested router
interface Layer {
  route?: { path: string; methods: Record<string, boolean> }
  handle: { stack?: Layer[] }
}

// Lists every `METHOD /path` mounted on a router, with Express params turned into OpenAPI ones (`:id` -> `{id}`)
function listRoutes(stack: Layer[]): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = layer.route.path.replace(/:(\w+)/g, '{$1}')
      return Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${path}`,
      )
    }
    return layer.handle.stack ? listRoutes(layer.handle.stack) : []
  })
}

// Lists every `METHOD /path` the OpenAPI document describes
function listDocumentedOperations(): string[] {
  return Object.entries(openapiSpec.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
  )
}

// Collects every `$ref` value found anywhere in a JSON value
function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRefs)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' ? [child] : collectRefs(child),
  )
}

// Resolves a local `#/components/<kind>/<name>` reference against the document
function resolveRef(ref: string): unknown {
  const [, kind, name] =
    /^#\/components\/(schemas|responses|parameters)\/(.+)$/.exec(ref) ?? []
  if (!kind || !name) return undefined
  return (openapiSpec.components[kind as 'schemas'] as Record<string, unknown>)[
    name
  ]
}

describe('openapiSpec', () => {
  it('is an OpenAPI 3.1 document served under /api', () => {
    expect(openapiSpec.openapi).toBe('3.1.0')
    expect(openapiSpec.info.title).toBe('ROM RAG BUT3 API')
  })

  it('documents every route mounted on the root router, and nothing else', () => {
    const routes = listRoutes(rootRouter.stack as unknown as Layer[])

    expect(routes.length).toBeGreaterThan(0)
    expect(listDocumentedOperations().sort()).toEqual(routes.sort())
  })

  it('gives every operation a tag, a summary and at least one response', () => {
    for (const operations of Object.values(openapiSpec.paths)) {
      for (const operation of Object.values(operations)) {
        expect(operation).toMatchObject({
          tags: [expect.any(String)],
          summary: expect.any(String),
          responses: expect.any(Object),
        })
      }
    }
  })

  it('declares the session cookie on authenticated operations only', () => {
    const me = openapiSpec.paths['/auth/me']?.get
    const login = openapiSpec.paths['/auth/login']?.post

    expect(me).toHaveProperty('security', [{ sessionCookie: [] }])
    expect(login).not.toHaveProperty('security')
    expect(openapiSpec.components.securitySchemes.sessionCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
    })
  })

  it('resolves every $ref to an existing component', () => {
    const refs = [...new Set(collectRefs(openapiSpec))]

    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(resolveRef(ref), ref).toBeDefined()
    }
  })

  it('references shared schemas instead of inlining them', () => {
    const detail = openapiSpec.components.schemas.CollectionDetail

    expect(detail).toMatchObject({
      properties: {
        source: { $ref: '#/components/schemas/CollectionSource' },
        members: {
          items: { $ref: '#/components/schemas/CollectionMember' },
        },
      },
    })
    expect(openapiSpec.components.schemas.RomPage).toMatchObject({
      properties: {
        data: { items: { $ref: '#/components/schemas/RomSummary' } },
        pagination: { $ref: '#/components/schemas/Pagination' },
      },
    })
  })

  it('emits plain component schemas, without standalone JSON Schema keys', () => {
    for (const schema of Object.values(openapiSpec.components.schemas)) {
      expect(schema).not.toHaveProperty('$schema')
      expect(schema).not.toHaveProperty('$id')
    }
  })

  it('documents dates as ISO strings', () => {
    expect(openapiSpec.components.schemas.PublicUser).toMatchObject({
      properties: { createdAt: { type: 'string', format: 'date-time' } },
    })
  })

  it('documents request bodies as the client sends them (defaults are optional)', () => {
    const create = openapiSpec.components.schemas.CollectionCreateRequest as {
      required?: string[]
    }

    expect(create.required).toEqual(['canonicalTitle'])
  })
})
