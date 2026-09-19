import { Navigate, Outlet } from 'react-router'

// Guard to redirect to a login page if no session is currently active
export function ProtectedRoute() {
  const isAuthenticated = true // TODO: To be replaced with an actual authentication Redux slice

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace />
  }

  return <Outlet />
}
