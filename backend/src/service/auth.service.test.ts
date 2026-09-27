import { describe, expect, it } from 'vitest'
import {
  createSessionToken,
  hashPassword,
  toPublicUser,
  verifyPassword,
} from './auth.service.js'

// Tests for the pure authentication logic: hashing, session tokens, and the
// public projection of a user record.
describe('auth.service', () => {
  describe('hashPassword / verifyPassword', () => {
    it('produces a hash that verifies against the original password', async () => {
      const hashed = await hashPassword('correct horse battery staple')

      await expect(
        verifyPassword(hashed, 'correct horse battery staple'),
      ).resolves.toBe(true)
    })

    it('rejects a wrong password', async () => {
      const hashed = await hashPassword('correct horse battery staple')

      await expect(verifyPassword(hashed, 'wrong password')).resolves.toBe(
        false,
      )
    })

    it('never returns the plaintext password as the hash', async () => {
      const plain = 'correct horse battery staple'
      const hashed = await hashPassword(plain)

      expect(hashed).not.toBe(plain)
      expect(hashed).not.toContain(plain)
    })

    it('salts every hash differently, even for the same password', async () => {
      const [first, second] = await Promise.all([
        hashPassword('correct horse battery staple'),
        hashPassword('correct horse battery staple'),
      ])

      expect(first).not.toBe(second)
    })
  })

  describe('createSessionToken', () => {
    it('generates a URL-safe, sufficiently long token', () => {
      const token = createSessionToken()

      // 32 random bytes, base64url-encoded, is 43 chars without padding.
      expect(token.length).toBe(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('never repeats a token across calls', () => {
      const tokens = new Set(
        Array.from({ length: 100 }, () => createSessionToken()),
      )

      expect(tokens.size).toBe(100)
    })
  })

  describe('toPublicUser', () => {
    it('strips passwordHash and every other private field', () => {
      const user = {
        id: 'user-1',
        email: 'player@example.com',
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$...',
        displayName: 'Player One',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }

      const publicUser = toPublicUser(user)

      expect(publicUser).toEqual({
        id: 'user-1',
        email: 'player@example.com',
        displayName: 'Player One',
        createdAt: user.createdAt,
      })
      expect(JSON.stringify(publicUser)).not.toContain('passwordHash')
      expect(JSON.stringify(publicUser)).not.toContain('argon2')
    })

    it('keeps a null displayName as null', () => {
      const publicUser = toPublicUser({
        id: 'user-1',
        email: 'player@example.com',
        displayName: null,
        createdAt: new Date(),
      })

      expect(publicUser.displayName).toBeNull()
    })
  })
})
