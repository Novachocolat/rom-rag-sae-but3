import { Link } from 'react-router'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/app/components/ui/table'
import { Button } from '@/app/components/ui/button'
import { useAppDispatch } from '@/app/store/store-hooks'
import { setPage } from '@/app/store/slices/filters.slice'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { RomStatusBadge } from '@/app/components/library/RomStatusBadge'
import { LibraryFilters } from '@/app/components/library/LibraryFilters'
import { useLibraryRoms } from '@/app/hooks/library/useLibraryRoms'

// Page for users to consult their library
export function LibraryPage() {
  const dispatch = useAppDispatch()
  const { data, isLoading, isFetching } = useLibraryRoms()
  const pagination = data?.pagination

  return (
    <div className="space-y-4">
      <LibraryFilters />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5}>Loading...</TableCell>
            </TableRow>
          )}
          {data?.data.map((rom) => (
            <TableRow key={rom.id}>
              <TableCell>
                <Link
                  to={`/roms/${rom.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {rom.title ?? rom.fileName}
                </Link>
              </TableCell>
              <TableCell>{rom.platformName ?? '—'}</TableCell>
              <TableCell>
                {(Number(rom.sizeBytes) / 1_000_000).toFixed(1)} Mb
              </TableCell>
              <TableCell>
                <RomStatusBadge source={rom.identificationSource} />
              </TableCell>
              <TableCell>
                <ConfidenceBadge
                  confidence={
                    rom.identificationSource === 'UNIDENTIFIED'
                      ? null
                      : rom.confidence
                  }
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={pagination.page <= 1 || isFetching}
            onClick={() => dispatch(setPage(pagination.page - 1))}
          >
            Previous
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {pagination.page} / {pagination.totalPages} · {pagination.total}{' '}
            ROMs
          </span>
          <Button
            variant="outline"
            disabled={pagination.page >= pagination.totalPages || isFetching}
            onClick={() => dispatch(setPage(pagination.page + 1))}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
