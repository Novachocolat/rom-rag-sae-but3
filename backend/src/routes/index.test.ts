import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { rootRouter } from './index.js'

// Tests for the root router, which mounts every routes
describe('rootRouter', () => {
  it('must be correctly defined as an Express router instance', () => {
    expect(rootRouter).toBeDefined()
    expect(typeof rootRouter).toBe('function')
  })

  it('must be able to call mounted routes', async () => {
    const app = express()
    rootRouter.get('/ping', (_req, res) => {
      res.sendStatus(200)
    })
    app.use('/api', rootRouter)

    const response = await request(app).get('/api/ping')
    expect(response.status).toBe(200)
  })
})
