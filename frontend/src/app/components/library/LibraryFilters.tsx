import { Input } from '@/app/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/app/components/ui/select'
import { useAppDispatch, useAppSelector } from '@/app/store/store-hooks'
import {
  setSearch,
  setPlatformId,
  setIdentificationSource,
} from '@/app/store/slices/filters.slice'
import { usePlatforms } from '@/app/hooks/library/usePlatforms'

// Every identification sources in an read-only array
const SOURCES = [
  'DAT_SHA1',
  'DAT_MD5',
  'DAT_SHA1_DATA',
  'DAT_MD5_DATA',
  'DAT_NAME',
  'AI_PROPOSED',
  'USER_CONFIRMED',
  'UNIDENTIFIED',
] as const

// Component to display filters for the library
export function LibraryFilters() {
  const dispatch = useAppDispatch()
  const filters = useAppSelector((state) => state.filters)
  const platforms = usePlatforms()

  const platformItems = {
    all: 'Any platform',
    ...Object.fromEntries((platforms.data ?? []).map((p) => [p.id, p.name])),
  }
  const sourceItems = {
    all: 'Any source',
    ...Object.fromEntries(SOURCES.map((s) => [s, s])),
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Input
        placeholder="Find..."
        value={filters.search}
        onChange={(e) => dispatch(setSearch(e.target.value))}
        className="max-w-xs"
      />

      <Select
        items={platformItems}
        value={filters.platformId ?? 'all'}
        onValueChange={(value) =>
          dispatch(setPlatformId(value === 'all' ? null : value))
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any platform</SelectItem>
          {platforms.data?.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={sourceItems}
        value={filters.identificationSource ?? 'all'}
        onValueChange={(value) =>
          dispatch(
            setIdentificationSource(
              value === 'all' ? null : (value as (typeof SOURCES)[number]),
            ),
          )
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any source</SelectItem>
          {SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
