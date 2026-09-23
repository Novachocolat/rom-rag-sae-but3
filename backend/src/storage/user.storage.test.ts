import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { createUser, findUserByEmail, findUserById } from './user.storage.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

const findUnique = vi.mocked(prisma.user.findUnique)
const create = vi.mocked(prisma.user.create)

// Tests for the Prisma access layer for users: each function must delegate
// to the right Prisma call with the right arguments, nothing more.
describe('user.storage', () => {
  it('findUserByEmail looks up by the unique email field', async () => {
    // @ts-expect-error partial mock, only the fields the test needs
    findUnique.mockResolvedValue({ id: 'user-1' })

    const result = await findUserByEmail('player@example.com')

    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'player@example.com' },
    })
    expect(result).toEqual({ id: 'user-1' })
  })

  it('findUserById looks up by id', async () => {
    // @ts-expect-error partial mock, only the fields the test needs
    findUnique.mockResolvedValue({ id: 'user-1' })

    await findUserById('user-1')

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } })
  })

  it('createUser forwards the payload as-is to Prisma', async () => {
    const data = {
      email: 'player@example.com',
      passwordHash: 'hashed',
      displayName: 'Player One',
    }
    // @ts-expect-error partial mock, only the fields the test needs
    create.mockResolvedValue({ id: 'user-1', ...data })

    await createUser(data)

    expect(create).toHaveBeenCalledWith({ data })
  })
})
