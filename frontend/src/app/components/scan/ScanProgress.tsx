import {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
} from '@/app/components/ui/progress'
import type { ScanProgress as ScanProgressData } from '@repo/shared/types'

// Component to follow a scan progress in real time
export function ScanProgress({ progress }: { progress: ScanProgressData }) {
  const percent =
    progress.totalFiles > 0
      ? Math.round((progress.processedFiles / progress.totalFiles) * 100)
      : 0

  return (
    <div className="space-y-3">
      <Progress value={percent}>
        <div className="flex justify-between">
          <ProgressLabel>Scan in progress ({progress.status})</ProgressLabel>
          <ProgressValue />
        </div>
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>

      <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
        <div>
          {progress.processedFiles} / {progress.totalFiles} files
        </div>
        <div>{progress.identifiedCount} identified</div>
        <div>{progress.errorCount} errors</div>
      </div>

      {progress.current && (
        <p className="truncate text-xs text-muted-foreground">
          Current: {progress.current}
        </p>
      )}
      {progress.errorMessage && (
        <p className="text-xs text-destructive">{progress.errorMessage}</p>
      )}
    </div>
  )
}
