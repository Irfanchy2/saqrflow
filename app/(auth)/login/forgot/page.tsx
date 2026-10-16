import Link from 'next/link'
import { Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { requestPasswordReset } from '@/app/actions/auth'
export const metadata = { title: 'Reset password' }
export default function Forgot() {
  return <Card className="p-6"><h1 className="mb-1 text-xl font-bold tracking-[-0.02em]">Reset your password</h1>
    <p className="mb-5 text-sm text-muted">Enter the email you sign in with. We send a link that works once and expires within an hour.</p>
    <ActionForm action={requestPasswordReset} submit="Send reset link" resetOnSuccess={false} variant="blue" block>
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus /></Field>
    </ActionForm>
    <Link href="/login" className="mt-5 block text-center text-sm font-medium text-primary hover:underline">Back to sign in</Link></Card>
}
