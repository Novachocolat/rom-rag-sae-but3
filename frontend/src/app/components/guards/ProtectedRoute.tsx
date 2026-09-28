import { Navigate, Outlet } from 'react-router'
import { useMe } from '@/app/hooks/auth/useMe'

// Guard to redirect to a login page if no session is currently active
export function ProtectedRoute() {
  const { data: user, isLoading } = useMe() // Gets user's session

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Chargement...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
