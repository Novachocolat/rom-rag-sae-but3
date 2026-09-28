import { scanProgressSchema } from '@repo/shared/schemas'
import { z } from 'zod'
import { redis } from '../lib/redis.js'

const SCAN_PROGRESS_TTL_SECONDS = 6 * 60 * 60

// The owner is stored alongside the public shape so routes can check it
const storedScanProgressSchema = scanProgressSchema.extend({
  userId: z.string(),
})

export type StoredScanProgress = z.infer<typeof storedScanProgressSchema>

// Gets a Redis scan key from its job ID
function scanProgressKey(jobId: string): string {
  return `scan:${jobId}`
}

// Overwrites a scan's progress and renews its TTL
export async function saveScanProgress(
  progress: StoredScanProgress,
): Promise<void> {
  await redis.set(
    scanProgressKey(progress.jobId),
    JSON.stringify(progress),
    'EX',
    SCAN_PROGRESS_TTL_SECONDS,
  )
}

// Returns a scan's progress, or null if unknown or expired
export async function getScanProgress(
  jobId: string,
): Promise<StoredScanProgress | null> {
  const raw = await redis.get(scanProgressKey(jobId))
  return raw === null ? null : storedScanProgressSchema.parse(JSON.parse(raw))
}
