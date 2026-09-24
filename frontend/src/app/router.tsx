import { createBrowserRouter, Navigate } from 'react-router'
import App from '@/App.tsx'
import { ProtectedRoute } from '@/app/components/guards/ProtectedRoute.tsx'
import { AppLayout } from '@/app/components/layouts/AppLayout.tsx'
import { SignupPage } from '@/app/components/pages/auth/SignupPage.tsx'
import LoginPage from '@/app/components/pages/auth/LoginPage.tsx'
import { SettingsPage } from '@/app/components/pages/SettingsPage'

// Centralizes routing
export const router = createBrowserRouter([
  // Public routes
  { path: '/inscription', element: <SignupPage /> },
  { path: '/connexion', element: <LoginPage /> },

  // Protected routes
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <App /> },
          { path: '/parametres', element: <SettingsPage /> },
        ],
      },
    ],
  },

  // Fallback if the route is unknown
  { path: '*', element: <Navigate to="/" replace /> },
])
