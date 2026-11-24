import type { RomExportQuery } from '@repo/shared/types'
import { buttonVariants } from '@/app/components/ui/button'

const FORMATS: RomExportQuery['format'][] = ['csv', 'json']

interface ExportButtonsProps {
  collectionId?: string // Exports this collection only, the whole library otherwise
}

// Plain download links: the browser saves the file and sends the session cookie itself
export function ExportButtons({ collectionId }: ExportButtonsProps) {
  function exportUrl(format: RomExportQuery['format']): string {
    const params = new URLSearchParams({ format })
    if (collectionId) params.set('collectionId', collectionId)
    return `${import.meta.env.VITE_API_URL}/roms/export?${params}`
  }

  return (
    <div className="flex gap-2">
      {FORMATS.map((format) => (
        <a
          key={format}
          href={exportUrl(format)}
          download
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Export {format.toUpperCase()}
        </a>
      ))}
    </div>
  )
}
