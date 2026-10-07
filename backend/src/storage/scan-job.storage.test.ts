import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  createScanJob,
  findScanJob,
  finishScanJob,
  listScanJobs,
  markScanJobRunning,
} from './scan-job.storage.js'

// Mocks Prisma dependency
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    scanJob: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

const create = vi.mocked(prisma.scanJob.create)
const update = vi.mocked(prisma.scanJob.update)
const findFirst = vi.mocked(prisma.scanJob.findFirst)
const findMany = vi.mocked(prisma.scanJob.findMany)
const count = vi.mocked(prisma.scanJob.count)

// Tests for the Prisma access layer for scan jobs: each function must
// delegate to the right Prisma call with the right arguments, nothing more.
describe('scan-job.storage', () => {
  it('createScanJob inserts a PENDING job with every counter at zero', async () => {
    await createScanJob('user-1', 'snes')

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        rootRelativePath: 'snes',
        status: 'PENDING',
        totalFiles: 0,
        processedFiles: 0,
        identifiedCount: 0,
        unidentifiedCount: 0,
        errorCount: 0,
      },
    })
  })

  it('markScanJobRunning sets RUNNING and the total file count', async () => {
    await markScanJobRunning('job-1', 42)

    expect(update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'RUNNING', totalFiles: 42 },
    })
  })

  it('finishScanJob stores the final status, counters and finishedAt only', async () => {
    const counters = {
      processedFiles: 3,
      identifiedCount: 2,
      unidentifiedCount: 0,
      errorCount: 1,
      current: 'not-a-column.nes',
    }

    await finishScanJob('job-1', 'FAILED', counters, 'disk unreadable')

    expect(update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'FAILED',
        processedFiles: 3,
        identifiedCount: 2,
        unidentifiedCount: 0,
        errorCount: 1,
        errorMessage: 'disk unreadable',
        finishedAt: expect.any(Date),
      },
    })
  })

  it('findScanJob scopes the lookup to its owner', async () => {
    await findScanJob('job-1', 'user-1')

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', userId: 'user-1' },
    })
  })

  it('listScanJobs paginates the most recent jobs first', async () => {
    // @ts-expect-error partial mock, only the fields the test needs
    findMany.mockResolvedValue([{ id: 'job-3' }])
    count.mockResolvedValue(5)

    const result = await listScanJobs('user-1', 2, 2)

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { startedAt: 'desc' },
      skip: 2,
      take: 2,
    })
    expect(result).toEqual({ jobs: [{ id: 'job-3' }], total: 5 })
  })
})
