import { prisma } from '../lib/prisma.js'

interface CreateUserInput {
  email: string
  passwordHash: string
  displayName?: string
}

// Thin Prisma access layer for users. Keeps the `User` model out of the
// service/route layers so the storage strategy can change without touching
// business logic.

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } })
}

export function findUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export function createUser(data: CreateUserInput) {
  return prisma.user.create({ data })
}
