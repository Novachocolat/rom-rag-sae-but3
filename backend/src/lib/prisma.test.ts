import { describe, expect, it } from 'vitest'
import { prisma } from './prisma.js'

// Tests for the Prisma client, which uses a lazy pg Pool so that it doesn't connect when the module is imported for testing
describe('prisma client', () => {
  it('is constructed without connecting', () => {
    expect(prisma).toBeDefined()
    expect(typeof prisma.$connect).toBe('function')
    expect(typeof prisma.$disconnect).toBe('function')
  })

  it('exposes the generated User delegate', () => {
    expect(prisma.user).toBeDefined()
    expect(typeof prisma.user.count).toBe('function')
  })
})
