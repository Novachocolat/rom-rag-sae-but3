// In-memory job registry. ADR-012: a backend restart loses running jobs —
// acceptable for local evaluation, and why BullMQ isn't used here.

import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'

export type JobFn = (signal: AbortSignal) => Promise<void>

export type JobStatus = 'RUNNING' | 'DONE' | 'ERROR' | 'CANCELLED'

interface JobEntry {
  status: JobStatus
  controller: AbortController
}

const jobs = new Map<string, JobEntry>()

// Fire-and-forget: starts `fn`, catches rejections, returns the job id.
export function startJob(fn: JobFn): string {
  const id = randomUUID()
  const controller = new AbortController()

  jobs.set(id, { status: 'RUNNING', controller })

  fn(controller.signal)
    .then(() => {
      const entry = jobs.get(id)
      if (entry) entry.status = 'DONE'
    })
    .catch((err: unknown) => {
      const entry = jobs.get(id)
      if (entry) {
        entry.status = controller.signal.aborted ? 'CANCELLED' : 'ERROR'
      }
      if (!controller.signal.aborted) {
        logger.error(`Job ${id} failed`, { err })
      }
    })

  return id
}

export function cancelJob(id: string): boolean {
  const entry = jobs.get(id)
  if (!entry || entry.status !== 'RUNNING') return false

  entry.controller.abort()
  return true
}

export function getJobStatus(id: string): JobStatus | null {
  return jobs.get(id)?.status ?? null
}
