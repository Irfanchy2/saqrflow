// Mirror of the `role_permissions` table (supabase/migrations/0002). The DB is authoritative (RLS);
// this copy exists for UI gating and cheap pre-checks in server actions. A DB test asserts parity.
export const ROLES = ['super_admin','company_owner','hr_manager','accountant','project_manager','employee','viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'documents.view','documents.upload','records.edit','salary.view','finance.view','cheques.manage',
  'reminders.create','data.export','records.delete','users.manage','employees.view',
  'employees.view_sensitive','audit.view','settings.manage','sales.approve','records.purge','crm.view',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  company_owner: PERMISSIONS,
  hr_manager: ['documents.view','documents.upload','records.edit','salary.view','employees.view','employees.view_sensitive','reminders.create','data.export'],
  accountant: ['documents.view','records.edit','salary.view','finance.view','cheques.manage','reminders.create','data.export','crm.view'],
  project_manager: ['documents.view','documents.upload','records.edit','employees.view','reminders.create','crm.view'],
  employee: [],
  viewer: ['documents.view','employees.view','crm.view'],
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin', company_owner: 'Company Owner', hr_manager: 'HR Manager', accountant: 'Accountant',
  project_manager: 'Project Manager', employee: 'Employee', viewer: 'Read-only Viewer',
}

export const can = (role: Role | null | undefined, perm: Permission): boolean =>
  !!role && ROLE_PERMISSIONS[role]?.includes(perm)

export class ForbiddenError extends Error {
  constructor(perm: Permission) { super(`You do not have permission to do this (${perm}).`); this.name = 'ForbiddenError' }
}
export function assertCan(role: Role | null | undefined, perm: Permission): void {
  if (!can(role, perm)) throw new ForbiddenError(perm)
}
