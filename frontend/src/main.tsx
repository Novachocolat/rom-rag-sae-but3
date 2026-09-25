import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { TooltipProvider } from '@/app/components/ui/tooltip.tsx'
import { Toaster } from '@/app/components/ui/sonner'
import { store } from '@/app/store/store.ts'
import { queryClient } from '@/app/query-client.ts'
import { router } from '@/app/router.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
)
