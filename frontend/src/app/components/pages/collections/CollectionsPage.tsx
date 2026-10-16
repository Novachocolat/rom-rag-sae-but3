import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CollectionSource, CollectionSummary } from '@repo/shared/types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { CollectionDetail } from '@/app/components/pages/collections/CollectionDetail'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Skeleton } from '@/app/components/ui/skeleton'
import { useCollections } from '@/app/hooks/collections/useCollections'
import { useDetectCollections } from '@/app/hooks/collections/useDetectCollections'
import { usePlatforms } from '@/app/hooks/library/usePlatforms'
import { ApiError } from '@/lib/api-error'

// The detection job has no progress route: the list is refreshed while it runs
const DETECTION_REFRESH_MS = 3_000
const DETECTION_WATCH_MS = 60_000

const SOURCE_LABEL: Record<CollectionSource, string> = {
  DAT_CLONE: 'Catalog',
  AI: 'AI',
  MANUAL: 'Manual',
}

interface CollectionRowProps {
  collection: CollectionSummary
  platformName: string | undefined
}

// One game of the library, unfolding into its variants
function CollectionRow({ collection, platformName }: CollectionRowProps) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <li className="rounded-xl bg-card ring-1 ring-foreground/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm"
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{collection.canonicalTitle}</span>
        <span className="text-muted-foreground">{platformName ?? '—'}</span>
        <Badge variant="secondary">
          {collection.memberCount}{' '}
          {collection.memberCount === 1 ? 'variant' : 'variants'}
        </Badge>
        <Badge variant="outline">{SOURCE_LABEL[collection.source]}</Badge>
        {collection.source === 'AI' && (
          <ConfidenceBadge confidence={collection.confidence} />
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-3">
          <CollectionDetail collectionId={collection.id} />
        </div>
      )}
    </li>
  )
}

// Page for users to consult their library grouped by game
export function CollectionsPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [detecting, setDetecting] = useState(false)

  const { data, isLoading, isError } = useCollections(page)
  const { data: platforms } = usePlatforms()
  const detect = useDetectCollections()

  // Collections appear as the job creates them: refresh until it is likely over
  useEffect(() => {
    if (!detecting) return
    const refresh = setInterval(
      () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
      DETECTION_REFRESH_MS,
    )
    const stop = setTimeout(() => setDetecting(false), DETECTION_WATCH_MS)
    return () => {
      clearInterval(refresh)
      clearTimeout(stop)
    }
  }, [detecting, queryClient])

  function startDetection() {
    detect.mutate(undefined, {
      onSuccess: () => {
        setDetecting(true)
        toast.info('Detection started: collections appear as they are found.')
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : 'The detection could not be started.',
        ),
    })
  }

  const platformNameOf = (platformId: string | null) =>
    platforms?.find((platform) => platform.id === platformId)?.name

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Collections</h1>
          <p className="text-sm text-muted-foreground">
            Your library grouped by game. Unfold a game to see its variants.
          </p>
        </div>
        <Button
          onClick={startDetection}
          disabled={detect.isPending || detecting}
        >
          {detecting ? 'Detecting…' : 'Detect collections'}
        </Button>
      </div>

      {isLoading && <Skeleton className="h-40" />}
      {isError && (
        <p className="text-sm text-destructive">
          The collections could not be loaded.
        </p>
      )}
      {data && data.data.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No collection yet. Scan your ROMs, then run the detection.
        </div>
      )}

      <ul className="space-y-2">
        {data?.data.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            platformName={platformNameOf(collection.platformId)}
          />
        ))}
      </ul>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {page} / {data.pagination.totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
