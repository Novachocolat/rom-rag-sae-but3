import { Link, Outlet } from 'react-router'
import { useMe } from '@/app/hooks/auth/useMe.ts'

export function AppLayout() {
  const { data: user } = useMe()
  const isOllamaUp = false // TODO: To be replaced with an actual Ollama status checking

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Lateral navigation bar */}
      <aside className="w-64 border-r border-border bg-card p-6 flex flex-col justify-between">
        <div className="flex flex-col gap-6">
          <div className="font-bold text-lg tracking-tight">ROM RAG</div>
          <nav className="flex flex-col gap-2">
            <Link
              to="/"
              className="px-3 py-2 rounded-md hover:bg-accent font-medium text-sm"
            >
              Library
            </Link>
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 border-b border-border bg-card px-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>Ollama status :</span>
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${isOllamaUp ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-xs text-muted-foreground">
              {isOllamaUp ? 'Available' : 'Unavailable'}
            </span>
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            {user ? `Logged as: ${user.email}` : 'Guest'}
          </div>
        </header>

        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
