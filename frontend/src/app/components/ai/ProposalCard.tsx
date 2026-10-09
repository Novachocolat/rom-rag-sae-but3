import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { AiProposal } from '@repo/shared/types'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { useReviewProposal } from '@/app/hooks/ai/useReviewProposal'
import { ApiError } from '@/lib/api-error'

interface ProposalState {
  label: string
  className: string
  detail: string
}

// Says how a proposal reached its current state
// A REJECTED proposal nobody reviewed was discarded by the backend:
// - by its coherence checks when it lists issues
// - by the confidence threshold otherwise
function describeState(proposal: AiProposal): ProposalState {
  if (proposal.status === 'PENDING') {
    return {
      label: 'Awaiting your review',
      className: 'bg-amber-100 text-amber-900',
      detail: 'Nothing is written to the ROM unless you accept it.',
    }
  }
  if (proposal.status === 'ACCEPTED') {
    return {
      label: 'Accepted by you',
      className: 'bg-blue-600 text-white',
      detail: 'Its fields were written to the ROM when you accepted it.',
    }
  }
  if (proposal.reviewedAt) {
    return {
      label: 'Rejected by you',
      className: 'bg-muted text-muted-foreground',
      detail: 'It was never applied to the ROM.',
    }
  }
  return {
    label: 'Discarded automatically',
    className: 'bg-muted text-muted-foreground',
    detail:
      proposal.issues.length > 0
        ? 'It failed the coherence checks, so it was never offered for review.'
        : 'Its confidence was below the review threshold, so it was never offered for review.',
  }
}

// Component to show one AI proposal:
// - what the model proposed, why, with which model and prompt
// and the review actions while it is pending
export function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const review = useReviewProposal()

  const { identification } = proposal
  const state = describeState(proposal)
  const fields: [string, string | number | null][] = [
    ['Title', identification.title],
    ['Platform', identification.platform],
    ['Region', identification.region],
    ['Languages', identification.languages.join(', ') || null],
    ['Release year', identification.releaseYear],
    ['Publisher', identification.publisher],
    ['Genre', identification.genre],
  ]

  function submit(action: 'accept' | 'reject') {
    review.mutate(
      { proposalId: proposal.id, review: { action } },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast.success(
            action === 'accept'
              ? 'Proposal accepted: the ROM is now confirmed by you.'
              : 'Proposal rejected: the ROM is unchanged.',
          )
        },
        onError: (error) => {
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'The review could not be saved.',
          )
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge className="bg-amber-500 text-white">
            <Sparkles />
            AI proposal
          </Badge>
          <Badge className={state.className}>{state.label}</Badge>
        </CardTitle>
        <CardDescription>
          A hypothesis from a language model, not a catalog match.{' '}
          {state.detail}
        </CardDescription>
        <CardAction>
          <ConfidenceBadge confidence={proposal.confidence} />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Reasoning given by the model
          </p>
          <p className="italic">{identification.reasoning || '—'}</p>
        </div>

        {proposal.issues.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Coherence checks failed</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {proposal.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          Model <code>{proposal.model}</code> · prompt{' '}
          <code>
            {proposal.promptName}@{proposal.promptVersion}
          </code>{' '}
          · {new Date(proposal.createdAt).toLocaleString()}
          {identification.confidence !== proposal.confidence &&
            ` · the model's own score was ${identification.confidence.toFixed(2)}, adjusted because the title exists in an imported catalog`}
        </p>
      </CardContent>

      {/* Reviewing only writes to the database */}
      {proposal.status === 'PENDING' && (
        <CardFooter className="justify-end gap-2">
          <Button
            variant="outline"
            disabled={review.isPending}
            onClick={() => submit('reject')}
          >
            Reject
          </Button>
          <Button
            disabled={review.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Accept
          </Button>
        </CardFooter>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this AI proposal?</DialogTitle>
            <DialogDescription>
              The proposed fields will be written to the ROM, which will then be
              shown as confirmed by you. No catalog has verified them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={review.isPending}
              onClick={() => submit('accept')}
            >
              Accept proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
