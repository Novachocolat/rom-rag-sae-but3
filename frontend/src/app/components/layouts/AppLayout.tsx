import { Link, Outlet, useNavigate } from 'react-router'
import { useMe } from '@/app/hooks/auth/useMe.ts'
import { LayoutGrid, LogOut, Settings } from 'lucide-react'
import { useLogout } from '@/app/hooks/auth/useLogout'
import { Button } from '@/app/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'

// Declares navigation items
const NAV_ITEMS = [
  { to: '/', label: 'Bibliothèque', icon: LayoutGrid },
  { to: '/settings', label: 'Paramètres', icon: Settings },
]

export function AppLayout() {
  const { data: user } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const isOllamaUp = false // TODO: To be replaced with an actual Ollama status checking

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Lateral navigation bar */}
      <aside className="w-64 border-r border-border bg-card p-6 flex flex-col justify-between">
        <div className="flex flex-col gap-6">
          <div className="font-bold text-lg tracking-tight">ROM RAG</div>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent font-medium text-sm text-muted-foreground hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 border-b border-border bg-card px-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>Statut d'Ollama :</span>
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${isOllamaUp ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-xs text-muted-foreground">
              {isOllamaUp ? 'Disponible' : 'Indisponible'}
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="text-sm font-medium" />
              }
            >
              {user ? (user.displayName ?? user.email) : 'Invité'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  logout.mutate(undefined, {
                    onSuccess: () => navigate('/login', { replace: true }),
                  })
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
