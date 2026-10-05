import { Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { verifyMfa } from '@/app/actions/auth'
export default function Mfa() {
  return <Card className="p-6"><h1 className="mb-1 text-lg font-semibold">Two-step verification</h1><p className="mb-5 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
    <ActionForm action={verifyMfa} submit="Verify" resetOnSuccess={false}><Field label="Code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus /></Field></ActionForm></Card>
}
