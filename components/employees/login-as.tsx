import { ActionButton } from '@/components/ui/action-form'
import { LogIn } from '@/components/icons'
import { loginAsEmployee } from '@/app/actions/impersonate'

/** Opens this employee's portal as them (owners only; checked again on the server). "Back to admin" returns. */
export function LoginAsButton({ id, name, variant = 'ghost' }: { id: string; name: string; variant?: 'ghost' | 'secondary' }) {
  return <span data-login-as={id}><ActionButton variant={variant} action={loginAsEmployee.bind(null, id)}
    confirm={`Open ${name}'s employee portal as ${name}? You can come back with "Back to admin". This is recorded in the audit log.`}>
    <LogIn size={14} aria-hidden />Log in as employee</ActionButton></span>
}
