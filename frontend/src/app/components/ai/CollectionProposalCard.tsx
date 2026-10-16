import { Link } from 'react-router'
import { Sparkles } from 'lucide-react'
import type { CollectionProposal } from '@repo/shared/types'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { RomStatusBadge } from '@/app/components/library/RomStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert'
import { Badge } from '@/app/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table'
import { cn } from '@/lib/utils'

interface CollectionProposalCardProps {
  proposal: CollectionProposal
  excludedRomIds: string[]
  onToggleExclude: (romId: string) => void
}

// Mean raw cosine similarity of each member to the others: a ROM absent from the map has no vector
function meanSimilarityByRom({
  collection,
}: CollectionProposal): Map<string, number> {
  const sums = new Map<string, { total: number; count: number }>()
  for (const { romA, romB, similarity } of collection.similarities) {
    for (const romId of [romA, romB]) {
      const entry = sums.get(romId) ?? { total: 0, count: 0 }
      entry.total += similarity
      entry.count += 1
      sums.set(romId, entry)
    }
  }
  return new Map(
    [...sums].map(([romId, { total, count }]) => [romId, total / count]),
  )
}

// Component to show one AI grouping proposal:
// - the candidate ROMs with their cosine score and proposed variant label
// - a checkbox per ROM to leave it out before accepting
// The accept and reject actions belong to the review page
export function CollectionProposalCard({
  proposal,
  excludedRomIds,
  onToggleExclude,
}: CollectionProposalCardProps) {
  const { collection } = proposal
  const scores = meanSimilarityByRom(proposal)
  const fileNameOf = new Map(
    collection.members.map((member) => [member.romId, member.fileName]),
  )
  const kept = collection.members.length - excludedRomIds.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge className="bg-amber-500 text-white">
            <Sparkles />
            AI grouping
          </Badge>
          <span>{collection.canonicalTitle}</span>
        </CardTitle>
        <CardDescription>
          The model thinks these ROMs are the same game. Nothing is kept unless
          you accept it, and a rejection dissolves the collection.
        </CardDescription>
        <CardAction>
          <ConfidenceBadge confidence={proposal.confidence} />
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Keep</TableHead>
              <TableHead className="w-8">#</TableHead>
              <TableHead>ROM</TableHead>
              <TableHead>Variant</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Cosine</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collection.members.map((member, position) => {
              const excluded = excludedRomIds.includes(member.romId)
              const score = scores.get(member.romId)

              return (
                <TableRow
                  key={member.romId}
                  className={cn(excluded && 'opacity-50')}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={!excluded}
                      onChange={() => onToggleExclude(member.romId)}
                      aria-label={`Keep ${member.fileName} in the collection`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {position < 9 ? position + 1 : ''}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/roms/${member.romId}`}
                      className={cn(
                        'font-medium underline-offset-4 hover:underline',
                        excluded && 'line-through',
                      )}
                    >
                      {member.fileName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {(member.sizeBytes / 1_000_000).toFixed(1)} Mb
                    </div>
                  </TableCell>
                  <TableCell>{member.variantLabel ?? '—'}</TableCell>
                  <TableCell>{member.region ?? '—'}</TableCell>
                  <TableCell>
                    <RomStatusBadge source={member.identificationSource} />
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={
                      score === undefined
                        ? 'This ROM has no vector yet'
                        : `Raw mean cosine similarity to the other members: ${score}`
                    }
                  >
                    {score === undefined ? '—' : score.toFixed(3)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {kept < 2 && (
          <Alert variant="destructive">
            <AlertTitle>Not enough members</AlertTitle>
            <AlertDescription>
              A collection needs at least two ROMs. Keep more of them, or reject
              the grouping.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Reasoning given by the model
          </p>
          <p className="italic">{proposal.reasoning || '—'}</p>
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

        {collection.similarities.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Pairwise cosine scores ({collection.similarities.length})
            </summary>
            <ul className="mt-2 space-y-0.5 tabular-nums">
              {collection.similarities.map((pair) => (
                <li key={`${pair.romA}:${pair.romB}`}>
                  {pair.similarity.toFixed(4)} ·{' '}
                  {fileNameOf.get(pair.romA) ?? pair.romA} ↔{' '}
                  {fileNameOf.get(pair.romB) ?? pair.romB}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-xs text-muted-foreground">
          Model <code>{proposal.model}</code> · prompt{' '}
          <code>
            {proposal.promptName}@{proposal.promptVersion}
          </code>{' '}
          · {new Date(proposal.createdAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  )
}
