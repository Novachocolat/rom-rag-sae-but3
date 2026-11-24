import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client.ts'

// Hook to call POST /dat/upload to import a .dat catalog picked from the disk
export function useImportDat() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) =>
      apiClient<{ insertedEntries: number }>(
        `/dat/upload?${new URLSearchParams({ fileName: file.name })}`,
        {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': 'application/octet-stream' },
        },
      ),
    onSuccess: () => {
      // A new catalog can bring a new platform to the library filters
      queryClient.invalidateQueries({ queryKey: ['platforms'] })
    },
  })
}
