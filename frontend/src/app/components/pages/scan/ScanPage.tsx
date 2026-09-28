import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'
import { Button } from '@/app/components/ui/button'
import { ScanProgress } from '@/app/components/scan/ScanProgress'
import { useStartScan } from '@/app/hooks/scan/useStartScan'
import { useScanProgress } from '@/app/hooks/scan/useScanProgress'

// React Query function to browse an user's ROM library
function useBrowse(path: string) {
  return useQuery({
    queryKey: ['library', 'browse', path],
    queryFn: () =>
      apiClient<{ path: string; directories: string[] }>(
        `/library/browse?path=${encodeURIComponent(path)}`,
      ),
  })
}

// Page for users to start a scan of a ROM directory
export function ScanPage() {
  const [path, setPath] = useState('')
  const [jobId, setJobId] = useState<string>()
  const browse = useBrowse(path)
  const startScan = useStartScan()
  const progress = useScanProgress(jobId)

  function enterDirectory(dir: string) {
    setPath((current) => (current ? `${current}/${dir}` : dir))
  }

  function goUp() {
    setPath((current) => current.split('/').slice(0, -1).join('/'))
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">/{path}</p>

      <div className="flex flex-wrap gap-2">
        {path && (
          <Button variant="ghost" onClick={goUp}>
            ..
          </Button>
        )}
        {browse.data?.directories.map((dir) => (
          <Button
            key={dir}
            variant="outline"
            onClick={() => enterDirectory(dir)}
          >
            {dir}
          </Button>
        ))}
      </div>

      <Button
        disabled={startScan.isPending || progress.data?.status === 'RUNNING'}
        onClick={() =>
          startScan.mutate(
            { path },
            { onSuccess: ({ jobId }) => setJobId(jobId) },
          )
        }
      >
        Lancer
      </Button>

      {progress.data && <ScanProgress progress={progress.data} />}
    </div>
  )
}
