import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'

// In-memory registry: a backend restart loses every running job (see ADR-012)
const jobs = new Map<string, AbortController>()

/**
 * Starts `fn` without awaiting it and returns its job id; a rejection is logged,
 * never left unhandled. Pass `id` to reuse an id that is already persisted.
 */
export function startJob(
  fn: (signal: AbortSignal) => Promise<unknown>,
  id: string = randomUUID(),
): string {
  const controller = new AbortController()
  jobs.set(id, controller)

  // Deferred by a microtask so a synchronous throw in `fn` is caught as well
  Promise.resolve()
    .then(() => fn(controller.signal))
    .catch((err: unknown) => {
      logger.error(`Job ${id} failed`, {
        stack: err instanceof Error ? err.stack : String(err),
      })
    })
    .finally(() => jobs.delete(id))

  return id
}

// Aborts a running job; false if the id is unknown or the job already ended
export function cancelJob(id: string): boolean {
  const controller = jobs.get(id)
  if (!controller) return false

  controller.abort()
  return true
}
