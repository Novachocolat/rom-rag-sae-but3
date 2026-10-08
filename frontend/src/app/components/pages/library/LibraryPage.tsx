import { Link } from 'react-router'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/app/components/ui/table'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { RomStatusBadge } from '@/app/components/library/RomStatusBadge'
import { LibraryFilters } from '@/app/components/library/LibraryFilters'
import { useLibraryRoms } from '@/app/hooks/library/useLibraryRoms'

// Page for users to consult their library
export function LibraryPage() {
  const { data, isLoading } = useLibraryRoms()

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
    </div>
  )
}
