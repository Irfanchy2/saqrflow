import { redirect } from 'next/navigation'
import { Card, Field, Input } from '@/components/ui/primitives'
import { ActionForm } from '@/components/ui/action-form'
import { createCompany } from '@/app/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { EmptyArt } from '@/components/ui/empty-art'
import { Building2 } from '@/components/icons'
export const metadata = { title: 'Set up your company' }
export default async function Onboarding() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser(); if (!user) redirect('/login')
  const { data: p } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle(); if (p) redirect('/')
  return <Card className="p-6"><EmptyArt icon={Building2} className="mb-4" /><h1 className="mb-1 text-lg font-semibold">Set up your company</h1>
    <p className="mb-5 text-sm text-muted">We'll create standard UAE document categories and make you the Company Owner. You can invite your team afterwards.</p>
    <ActionForm action={createCompany} submit="Create company" resetOnSuccess={false}>
      <Field label="Company name"><Input name="company" placeholder="Al Saqr Steels" required /></Field>
      <Field label="Your full name"><Input name="name" autoComplete="name" required /></Field></ActionForm></Card>
}
