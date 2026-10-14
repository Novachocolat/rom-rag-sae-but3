import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { CollectionProposalCard } from '@/app/components/ai/CollectionProposalCard'
import { ProposalCard } from '@/app/components/ai/ProposalCard'
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert'
import { Button } from '@/app/components/ui/button'
import { Skeleton } from '@/app/components/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/app/components/ui/tabs'
import { useProposals } from '@/app/hooks/ai/useProposals'
import { useReviewProposal } from '@/app/hooks/ai/useReviewProposal'
import { useAcceptCollection } from '@/app/hooks/collections/useAcceptCollection'
import {
  REVIEW_PAGE_SIZE,
  useCollectionProposals,
} from '@/app/hooks/collections/useCollectionProposals'
import { useRejectCollection } from '@/app/hooks/collections/useRejectCollection'
import {
  clearExcluded,
  setIndex,
  setTab,
  toggleExcluded,
  type ReviewTab,
} from '@/app/store/slices/review.slice'
import { useAppDispatch, useAppSelector } from '@/app/store/store-hooks'
import { ApiError } from '@/lib/api-error'

type ReviewAction = 'accept' | 'reject'

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The review could not be saved.'
}

// Keys typed in a text field, or aimed at the tab list or a dialog, are not shortcuts
function isShortcutBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[role="tablist"], [role="dialog"]')) return true
  if (target instanceof HTMLInputElement) return target.type !== 'checkbox'
  return (
    target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ml-1.5 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}

function EmptyQueue() {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      Nothing left to review.{' '}
      <Link to="/" className="underline underline-offset-4">
        Back to the library
      </Link>
    </div>
  )
}

function QueueStatus({
  isLoading,
  isError,
}: {
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) return <Skeleton className="h-96" />
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>The queue could not be loaded</AlertTitle>
        <AlertDescription>Reload the page to try again.</AlertDescription>
      </Alert>
    )
  }
  return <EmptyQueue />
}

// Page to arbitrate every AI proposal from a single queue, with keyboard shortcuts:
// A accepts, R rejects, left and right arrows move, 1 to 9 leave a ROM out of a grouping
export function ReviewPage() {
  const dispatch = useAppDispatch()
  const { tab, indexes, excludedRomIds } = useAppSelector(
    (state) => state.review,
  )

  const identificationsQuery = useProposals({ pageSize: REVIEW_PAGE_SIZE })
  const groupingsQuery = useCollectionProposals()
  const reviewIdentification = useReviewProposal()
  const acceptCollection = useAcceptCollection()
  const rejectCollection = useRejectCollection()

  // Items already sent: hidden at once so the next keypress targets the next
  // item without waiting for the refetch, and shown again if the request fails
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set())

  const identifications = useMemo(
    () =>
      (identificationsQuery.data?.data ?? []).filter(
        (proposal) => !handled.has(proposal.id),
      ),
    [identificationsQuery.data, handled],
  )
  const groupings = useMemo(
    () =>
      (groupingsQuery.data?.data ?? []).filter(
        (proposal) => !handled.has(proposal.proposalId),
      ),
    [groupingsQuery.data, handled],
  )

  const count =
    tab === 'identifications' ? identifications.length : groupings.length
  const index = Math.min(indexes[tab], Math.max(count - 1, 0))
  const currentIdentification = identifications[index]
  const currentGrouping = groupings[index]
  const currentExcluded = currentGrouping
    ? (excludedRomIds[currentGrouping.collection.id] ?? [])
    : []

  function markHandled(id: string, value: boolean) {
    setHandled((previous) => {
      const next = new Set(previous)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function move(delta: number) {
    dispatch(
      setIndex(Math.min(Math.max(index + delta, 0), Math.max(count - 1, 0))),
    )
  }

  function reviewCurrentIdentification(action: ReviewAction) {
    const proposal = currentIdentification
    if (!proposal) return

    markHandled(proposal.id, true)
    reviewIdentification
      .mutateAsync({ proposalId: proposal.id, review: { action } })
      .then(() =>
        toast.success(
          `${action === 'accept' ? 'Accepted' : 'Rejected'}: ${proposal.identification.title ?? proposal.romFileName}`,
        ),
      )
      .catch((error: unknown) => {
        markHandled(proposal.id, false)
        toast.error(errorMessage(error))
      })
  }

  function reviewCurrentGrouping(action: ReviewAction) {
    const proposal = currentGrouping
    if (!proposal) return

    const { id: collectionId, members, canonicalTitle } = proposal.collection
    if (action === 'accept' && members.length - currentExcluded.length < 2) {
      toast.error('Keep at least two ROMs, or reject the grouping.')
      return
    }

    markHandled(proposal.proposalId, true)
    const request: Promise<unknown> =
      action === 'accept'
        ? acceptCollection.mutateAsync({
            collectionId,
            excludeRomIds: currentExcluded,
          })
        : rejectCollection.mutateAsync(collectionId)

    request
      .then(() => {
        dispatch(clearExcluded(collectionId))
        toast.success(
          `${action === 'accept' ? 'Kept' : 'Dissolved'}: ${canonicalTitle}`,
        )
      })
      .catch((error: unknown) => {
        markHandled(proposal.proposalId, false)
        toast.error(errorMessage(error))
      })
  }

  function reviewCurrent(action: ReviewAction) {
    if (tab === 'identifications') reviewCurrentIdentification(action)
    else reviewCurrentGrouping(action)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    if (isShortcutBlocked(event.target)) return

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    if (key === 'a' || key === 'r') {
      event.preventDefault()
      reviewCurrent(key === 'a' ? 'accept' : 'reject')
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      move(key === 'ArrowLeft' ? -1 : 1)
    } else if (
      tab === 'collections' &&
      /^[1-9]$/.test(key) &&
      currentGrouping
    ) {
      const member = currentGrouping.collection.members[Number(key) - 1]
      if (!member) return
      event.preventDefault()
      dispatch(
        toggleExcluded({
          collectionId: currentGrouping.collection.id,
          romId: member.romId,
        }),
      )
    }
  }

  // The listener is registered once and always calls the latest handler
  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    onKeyDownRef.current = onKeyDown
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDownRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Review</h1>
        <p className="text-sm text-muted-foreground">
          Everything the AI proposes waits here until you decide.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          // Leaves the tab list so the arrow keys move through the items again
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          dispatch(setTab(value as ReviewTab))
        }}
      >
        <TabsList>
          <TabsTrigger value="identifications">
            Identifications ({identifications.length})
          </TabsTrigger>
          <TabsTrigger value="collections">
            Groupings ({groupings.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identifications" className="pt-2">
          {currentIdentification ? (
            <ProposalCard
              proposal={currentIdentification}
              showActions={false}
            />
          ) : (
            <QueueStatus
              isLoading={identificationsQuery.isLoading}
              isError={identificationsQuery.isError}
            />
          )}
        </TabsContent>

        <TabsContent value="collections" className="pt-2">
          {currentGrouping ? (
            <CollectionProposalCard
              proposal={currentGrouping}
              excludedRomIds={currentExcluded}
              onToggleExclude={(romId) =>
                dispatch(
                  toggleExcluded({
                    collectionId: currentGrouping.collection.id,
                    romId,
                  }),
                )
              }
            />
          ) : (
            <QueueStatus
              isLoading={groupingsQuery.isLoading}
              isError={groupingsQuery.isError}
            />
          )}
        </TabsContent>
      </Tabs>

      {count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous"
              disabled={index === 0}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {index + 1} / {count}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next"
              disabled={index >= count - 1}
              onClick={() => move(1)}
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => reviewCurrent('reject')}>
              Reject
              <Kbd>R</Kbd>
            </Button>
            <Button onClick={() => reviewCurrent('accept')}>
              Accept
              <Kbd>A</Kbd>
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Shortcuts: <Kbd>A</Kbd> accept · <Kbd>R</Kbd> reject · <Kbd>←</Kbd>
        <Kbd>→</Kbd> navigate
        {tab === 'collections' && (
          <>
            {' '}
            · <Kbd>1</Kbd>–<Kbd>9</Kbd> leave a ROM out
          </>
        )}
      </p>
    </div>
  )
}
