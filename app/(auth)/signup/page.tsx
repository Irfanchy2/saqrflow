import Link from 'next/link'
import { Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { signUp } from '@/app/actions/auth'
export const metadata = { title: 'Create account' }
export default function Signup() {
  return <Card className="p-6"><h1 className="mb-1 text-lg font-semibold">Create your account</h1><p className="mb-5 text-sm text-muted">You'll set up your company next.</p>
    <ActionForm action={signUp} submit="Create account" resetOnSuccess={false}>
      <Field label="Work email"><Input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" hint="At least 10 characters."><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
    </ActionForm>
    <p className="mt-4 text-center text-sm text-muted">Already registered? <Link className="text-primary hover:underline" href="/login">Sign in</Link></p></Card>
}
