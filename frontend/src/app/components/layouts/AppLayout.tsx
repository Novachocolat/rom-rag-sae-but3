import { Link, Outlet, useNavigate } from 'react-router'
import { useMe } from '@/app/hooks/auth/useMe.ts'
import { LayoutGrid, LogOut, Settings, ScanLine } from 'lucide-react'
import { useLogout } from '@/app/hooks/auth/useLogout'
import { Button } from '@/app/components/ui/button'
import { OllamaStatus } from '@/app/components/ai/OllamaStatus'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'

// Declares navigation items
const NAV_ITEMS = [
  { to: '/', label: 'Library', icon: LayoutGrid },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/scan', label: 'Scan', icon: ScanLine },
]

export function AppLayout() {
  const { data: user } = useMe() // Gets user's session
  const logout = useLogout()
  const navigate = useNavigate()

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
          <OllamaStatus />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="text-sm font-medium" />
              }
            >
              {user ? (user.displayName ?? user.email) : 'Guest'}
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
                Logout
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
