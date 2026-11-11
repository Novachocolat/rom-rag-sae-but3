import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { isDocsEnabled } from './docs.routes.js'

// Tests for the Swagger routes, mounted by `createApp` outside production only
describe('isDocsEnabled', () => {
  it('hides the documentation in production', () => {
    expect(isDocsEnabled('production')).toBe(false)
  })

  it('exposes the documentation in development and test', () => {
    expect(isDocsEnabled('development')).toBe(true)
    expect(isDocsEnabled('test')).toBe(true)
  })
})

describe('GET /api/docs.json', () => {
  it('serves the OpenAPI document without requiring a session', async () => {
    const res = await request(createApp()).get('/api/docs.json')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/health': expect.any(Object),
        '/roms': expect.any(Object),
      },
    })
  })
})

describe('GET /api/docs', () => {
  it('serves the Swagger UI page', async () => {
    const res = await request(createApp()).get('/api/docs/')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('swagger-ui')
  })

  it('serves the Swagger UI assets', async () => {
    const res = await request(createApp()).get('/api/docs/swagger-ui.css')

    expect(res.status).toBe(200)
  })
})
