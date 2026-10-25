import { redirect } from 'next/navigation'
import { ShieldCheck, UserPlus } from '@/components/icons'
import { getCtx } from '@/lib/auth'
import { Alert, Badge, Card, Field, Input, LinkButton, PageHeader, Select, Td, Th, TableWrap } from '@/components/ui/primitives'
import { DialogButton } from '@/components/ui/dialog'
import { ActionButton, ActionForm } from '@/components/ui/action-form'
import { changeRole, inviteUser, setUserActive } from '@/app/actions/admin'
import { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from '@/lib/permissions'

export const metadata = { title: 'User Management' }
export default async function Users() {
  const c = await getCtx(); if (!c.can('users.manage')) redirect('/')
  const canLink = c.can('employees.view_sensitive')
  const [{ data: users }, { data: emps }] = await Promise.all([
    c.supabase.from('profiles').select('id,full_name,role,is_active,created_at').order('created_at'),
    canLink ? c.supabase.from('employees').select('id,employee_no,full_name,user_id').is('deleted_at', null).neq('status', 'archived').order('full_name').limit(2000) : Promise.resolve({ data: [] as { id: string; employee_no: string; full_name: string; user_id: string | null }[] }),
  ])
  const nameOf = new Map((users ?? []).map(u => [u.id, u.full_name as string]))
  // Which employee record a login belongs to: the Employee Portal shows only that person's records. Required for the Employee role.
  const empSelect = (userId: string | null) => canLink && <Select name="employee_id" aria-label="Employee record" defaultValue={(emps ?? []).find(e => e.user_id && e.user_id === userId)?.id ?? ''} className="w-56 max-sm:min-w-0 max-sm:flex-1" data-employee-link>
    <option value="">— No employee record —</option>
    {(emps ?? []).map(e => { const other = !!e.user_id && e.user_id !== userId
      return <option key={e.id} value={e.id} disabled={other}>{e.full_name} ({e.employee_no}){other ? ` · linked to ${nameOf.get(e.user_id!) ?? 'another login'}` : ''}</option> })}
  </Select>
  return <><PageHeader title="User Management" sub="Roles are enforced by the database, not just the interface."
    actions={<><LinkButton href="/users/activity" variant="secondary"><ShieldCheck size={15} aria-hidden />Sign-in activity</LinkButton><DialogButton label="Invite user" title="Invite a user" icon={<UserPlus size={15} />}><ActionForm action={inviteUser} submit="Send invitation">
      <Field label="Full name"><Input name="name" required /></Field><Field label="Email"><Input name="email" type="email" required /></Field>
      <Field label="Role"><Select name="role" defaultValue="viewer">{ROLES.filter(r => r !== 'super_admin' || c.profile.role === 'super_admin').map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
      {canLink && <Field label="Employee record" hint="Required for the Employee role: their portal shows this person's own expenses, attendance and salary.">{empSelect(null)}</Field>}</ActionForm></DialogButton></>} />
    <Card className="mb-6 overflow-hidden"><TableWrap><thead className="border-b border-border bg-surface-2/60"><tr><Th>Name</Th><Th>{canLink ? 'Role and employee record' : 'Role'}</Th><Th>Status</Th><Th /></tr></thead><tbody className="divide-y divide-border">
      {users?.map(u => <tr key={u.id}><Td className="font-medium">{u.full_name}{u.id === c.userId && <Badge className="ms-2">you</Badge>}</Td>
        <Td className="max-sm:[grid-column:1/-1]"><ActionForm action={changeRole.bind(null, u.id)} submit="Save" resetOnSuccess={false} className="flex flex-wrap items-center gap-2"><Select name="role" defaultValue={u.role} aria-label="Role" className="w-44 max-sm:min-w-0 max-sm:flex-1">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>{empSelect(u.id)}</ActionForm></Td>
        <Td badge><Badge tone={u.is_active ? 'green' : 'neutral'}>{u.is_active ? 'Active' : 'Deactivated'}</Badge></Td>
        <Td>{u.id !== c.userId && <ActionButton action={setUserActive.bind(null, u.id, !u.is_active)} variant="ghost" confirm={u.is_active ? `Deactivate ${u.full_name}? They will lose access immediately.` : undefined}>{u.is_active ? 'Deactivate' : 'Reactivate'}</ActionButton>}</Td></tr>)}</tbody></TableWrap></Card>
    <Card className="overflow-x-auto"><div className="border-b border-border px-4 py-3 text-sm font-semibold">Permission matrix</div><TableWrap><thead className="border-b border-border"><tr><Th>Permission</Th>{ROLES.map(r => <Th key={r} className="text-center">{ROLE_LABELS[r]}</Th>)}</tr></thead><tbody className="divide-y divide-border">
      {PERMISSIONS.map(p => <tr key={p}><Td className="font-mono text-xs">{p}</Td>{ROLES.map(r => <Td key={r} className="text-center">{ROLE_PERMISSIONS[r].includes(p) ? <span className="text-success">●</span> : <span className="text-border">○</span>}</Td>)}</tr>)}</tbody></TableWrap></Card>
    <div className="mt-4"><Alert>The “Employee” role opens only the Employee Portal (My portal): its own expenses, attendance, salary, payslips, profile and documents. It never sees company finance, quotations, invoices, projects, settings or other employees. Choose each Employee login's employee record here, or from the employee page (Portal access). Approving employee expenses needs Owner, Super Admin or Accountant.</Alert></div></>
}
