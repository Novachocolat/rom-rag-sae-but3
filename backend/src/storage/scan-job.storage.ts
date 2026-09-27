import type { ScanJob, ScanJobStatus } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

export interface ScanJobCounters {
  processedFiles: number
  identifiedCount: number
  unidentifiedCount: number
  errorCount: number
}

export interface ListScanJobsResult {
  jobs: ScanJob[]
  total: number
}

// Inserts the durable record of a scan as PENDING, before it starts
export function createScanJob(
  userId: string,
  rootRelativePath: string,
): Promise<ScanJob> {
  return prisma.scanJob.create({
    data: {
      userId,
      rootRelativePath,
      status: 'PENDING',
      totalFiles: 0,
      processedFiles: 0,
      identifiedCount: 0,
      unidentifiedCount: 0,
      errorCount: 0,
    },
  })
}

// Marks a scan as RUNNING once its files have been counted
export function markScanJobRunning(
  id: string,
  totalFiles: number,
): Promise<ScanJob> {
  return prisma.scanJob.update({
    where: { id },
    data: { status: 'RUNNING', totalFiles },
  })
}

// Records the final state of a scan, which outlives its Redis progress
export function finishScanJob(
  id: string,
  status: Extract<ScanJobStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>,
  counters: ScanJobCounters,
  errorMessage: string | null,
): Promise<ScanJob> {
  return prisma.scanJob.update({
    where: { id },
    data: {
      status,
      processedFiles: counters.processedFiles,
      identifiedCount: counters.identifiedCount,
      unidentifiedCount: counters.unidentifiedCount,
      errorCount: counters.errorCount,
      errorMessage,
      finishedAt: new Date(),
    },
  })
}

// Returns a scan only if it belongs to `userId`, so ids never leak across users
export function findScanJob(
  id: string,
  userId: string,
): Promise<ScanJob | null> {
  return prisma.scanJob.findFirst({ where: { id, userId } })
}

// Lists a user's scans, most recent first
export async function listScanJobs(
  userId: string,
  page: number,
  pageSize: number,
): Promise<ListScanJobsResult> {
  const [jobs, total] = await Promise.all([
    prisma.scanJob.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.scanJob.count({ where: { userId } }),
  ])

  return { jobs, total }
}
