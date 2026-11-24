import type { ChangeEvent } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import { Input } from '@/app/components/ui/input'
import { useImportDat } from '@/app/hooks/dat/useImportDat'
import { ApiError } from '@/lib/api-error'

// Card to import a No-Intro .dat catalog from the user's disk
export function DatImportPanel() {
  const importDat = useImportDat()

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // Lets the same file be picked again
    if (!file) return

    importDat.mutate(file, {
      onSuccess: ({ insertedEntries }) =>
        toast.success(`${file.name}: ${insertedEntries} entries imported`),
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : 'The catalog could not be imported.',
        ),
    })
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>DAT catalogs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Import a No-Intro .dat catalog to identify the ROMs of a new platform.
        </p>
        <Input
          type="file"
          accept=".dat,.xml"
          disabled={importDat.isPending}
          onChange={onFileChange}
        />
      </CardContent>
    </Card>
  )
}
