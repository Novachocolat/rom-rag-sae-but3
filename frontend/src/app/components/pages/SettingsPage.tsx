import HealthPanel from '@/app/components/HealthPanel'
import { useLogout } from '@/app/hooks/auth/useLogout.ts'
import { useMe } from '@/app/hooks/auth/useMe.ts'
import { Button } from '@/app/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card.tsx'

// Page for users to configure their account, currently display dependencies status
export function SettingsPage() {
  const { data: user } = useMe()
  const logout = useLogout()

  return (
    <div className="space-y-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">E-mail</dt>
              <dd className="font-medium">{user?.email}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Nom</dt>
              <dd className="font-medium">
                {user?.displayName ?? user?.email}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Créé le</dt>
              <dd className="font-medium">
                {user ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
              </dd>
            </div>
          </dl>
          <Button
            variant="outline"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Se déconnecter
          </Button>
        </CardContent>
      </Card>

      <HealthPanel />
    </div>
  )
}
