import { createBrowserRouter, Navigate } from 'react-router'
import { ProtectedRoute } from '@/app/components/guards/ProtectedRoute.tsx'
import { AppLayout } from '@/app/components/layouts/AppLayout.tsx'
import { SignupPage } from '@/app/components/pages/auth/SignupPage.tsx'
import { LoginPage } from '@/app/components/pages/auth/LoginPage.tsx'
import { SettingsPage } from '@/app/components/pages/SettingsPage.tsx'
import { LibraryPage } from '@/app/components/pages/library/LibraryPage.tsx'
import { ScanPage } from '@/app/components/pages/scan/ScanPage.tsx'

// Centralizes routing
export const router = createBrowserRouter([
  // Public routes
  { path: '/signup', element: <SignupPage /> },
  { path: '/login', element: <LoginPage /> },

  // Protected routes
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <LibraryPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/scan', element: <ScanPage /> },
        ],
      },
    ],
  },

  // Fallback if the route is unknown
  { path: '*', element: <Navigate to="/" replace /> },
])
