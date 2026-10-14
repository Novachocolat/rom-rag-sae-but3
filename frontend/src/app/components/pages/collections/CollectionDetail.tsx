import { Link } from 'react-router'
import { RomStatusBadge } from '@/app/components/library/RomStatusBadge'
import { Skeleton } from '@/app/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table'
import { useCollection } from '@/app/hooks/collections/useCollection'

// Variants of one game: the ROMs of a collection with their proposed label
export function CollectionDetail({ collectionId }: { collectionId: string }) {
  const { data, isLoading, isError } = useCollection(collectionId)

  if (isLoading) return <Skeleton className="h-24" />
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        The variants could not be loaded.
      </p>
    )
  }

  const members = [...data.members].sort((a, b) =>
    a.fileName.localeCompare(b.fileName),
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Variant</TableHead>
          <TableHead>ROM</TableHead>
          <TableHead>Region</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.romId}>
            <TableCell>{member.variantLabel ?? '—'}</TableCell>
            <TableCell>
              <Link
                to={`/roms/${member.romId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {member.fileName}
              </Link>
            </TableCell>
            <TableCell>{member.region ?? '—'}</TableCell>
            <TableCell>
              {(member.sizeBytes / 1_000_000).toFixed(1)} Mb
            </TableCell>
            <TableCell>
              <RomStatusBadge source={member.identificationSource} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
