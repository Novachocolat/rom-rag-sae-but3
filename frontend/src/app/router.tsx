import { createBrowserRouter, Navigate } from 'react-router'
import App from '../App.tsx'
import { ProtectedRoute } from './components/guards/ProtectedRoute.tsx'
import { AppLayout } from './components/layouts/AppLayout.tsx'

// Centralizes routing
export const router = createBrowserRouter([
  // Public routes
  { path: '/signup', element: <div>Page d'inscription</div> },
  { path: '/signin', element: <div>Page de connexion</div> },

  // Protected routes
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [{ path: '/', element: <App /> }],
      },
    ],
  },

  // Fallback if the route is unknown
  { path: '*', element: <Navigate to="/" replace /> },
])
