import { describe, expect, it } from 'vitest'
import { env } from './env.js'

// Tests for the env module, which parses and validates environment variables
describe('env', () => {
  it('exposes the parsed environment', () => {
    expect(env.NODE_ENV).toBe('test')
    expect(env.CORS_ORIGIN).toBe('http://localhost:5173')
  })

  it('coerces PORT to a number', () => {
    expect(env.PORT).toBe(3000)
    expect(typeof env.PORT).toBe('number')
  })

  it('carries usable connection strings', () => {
    expect(env.DATABASE_URL).not.toContain('${')
    expect(env.REDIS_URL).not.toContain('${')
  })
})
