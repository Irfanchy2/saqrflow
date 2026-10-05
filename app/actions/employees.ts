'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getCtx, need } from '@/lib/auth'
import { safe, str } from '@/lib/action'
import { sha256Hex, validateUpload, storagePath } from '@/lib/files'
import { toE164 } from '@/lib/phone'
import type { ActionState } from '@/lib/utils'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()
const phone = z.string().optional().transform((v, ctx) => { if (!v) return undefined; const p = toE164(v); if (!p) { ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number (e.g. 050 123 4567)' }); return z.NEVER } return p })
const empSchema = z.object({
  employee_no: z.string().min(1, 'Employee ID is required').max(30), full_name: z.string().min(2, 'Full name is required').max(200),
  nationality: z.string().max(80).optional(), department: z.string().max(80).optional(), designation: z.string().max(120).optional(),
  phone, emergency_contact_name: z.string().max(120).optional(), emergency_contact_phone: phone,
  joining_date: date, status: z.enum(['active', 'on_leave', 'probation', 'resigned', 'terminated', 'archived']).default('active'),
  work_location: z.string().max(200).optional(), accommodation: z.string().max(200).optional(), notes: z.string().max(4000).optional(),
})
const FIELDS = ['employee_no', 'full_name', 'nationality', 'department', 'designation', 'phone', 'emergency_contact_name', 'emergency_contact_phone', 'joining_date', 'status', 'work_location', 'accommodation', 'notes']
const parseEmp = (fd: FormData) => empSchema.parse(Object.fromEntries(FIELDS.map(k => [k, str(fd, k)])))

export async function createEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit'); need(c, 'employees.view_sensitive')
    const e = parseEmp(fd)
    const { data, error } = await c.supabase.from('employees').insert({ ...e, company_id: c.company.id }).select('id').single()
    if (error) throw error
    const salary = str(fd, 'monthly_salary')
    if (salary && c.can('salary.view')) {
      const n = z.coerce.number().min(0).max(10_000_000).parse(salary)
      const { error: e2 } = await c.supabase.from('employee_compensation').insert({ employee_id: data.id, company_id: c.company.id, monthly_salary: n }); if (e2) throw e2
    }
    revalidatePath('/employees'); redirect(`/employees/${data.id}`)
  })
}
export async function updateEmployee(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const { data, error } = await c.supabase.from('employees').update(parseEmp(fd)).eq('id', id).select('id'); if (error) throw error
    if (!data?.length) return { error: 'Employee not found or you cannot edit this record.' }
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Saved.' }
  })
}
export async function setSalary(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const n = z.coerce.number({ message: 'Enter an amount' }).min(0).max(10_000_000).parse(str(fd, 'monthly_salary'))
    const { error } = await c.supabase.from('employee_compensation').upsert({ employee_id: id, company_id: c.company.id, monthly_salary: n, updated_at: new Date().toISOString() }); if (error) throw error
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Salary updated.' }
  })
}
export async function addSalaryPayment(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Choose the month'), amount: z.coerce.number().min(0), paid_on: date, method: z.enum(['wps', 'bank_transfer', 'cash', 'cheque']).optional(), notes: z.string().max(500).optional() })
      .parse({ period: str(fd, 'period'), amount: str(fd, 'amount'), paid_on: str(fd, 'paid_on'), method: str(fd, 'method'), notes: str(fd, 'notes') })
    const { error } = await c.supabase.from('salary_payments').insert({ ...v, period: v.period + '-01', employee_id: id, company_id: c.company.id })
    if (error) throw error
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Payment recorded.' }
  })
}
export async function addAdvance(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'salary.view')
    const v = z.object({ kind: z.enum(['advance', 'deduction']), amount: z.coerce.number().positive('Amount must be positive'), given_on: date, monthly_recovery: z.coerce.number().min(0).optional(), notes: z.string().max(500).optional() })
      .parse({ kind: str(fd, 'kind'), amount: str(fd, 'amount'), given_on: str(fd, 'given_on'), monthly_recovery: str(fd, 'monthly_recovery'), notes: str(fd, 'notes') })
    const { error } = await c.supabase.from('employee_advances').insert({ ...v, given_on: v.given_on ?? c.today, employee_id: id, company_id: c.company.id }); if (error) throw error
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Saved.' }
  })
}
export async function addLeave(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'employees.view_sensitive')
    const v = z.object({ leave_type: z.enum(['annual', 'sick', 'unpaid', 'emergency', 'other']), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date required'), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date required'), notes: z.string().max(500).optional() })
      .refine(d => d.end_date >= d.start_date, { message: 'End date must be on or after the start date', path: ['end_date'] })
      .parse({ leave_type: str(fd, 'leave_type'), start_date: str(fd, 'start_date'), end_date: str(fd, 'end_date'), notes: str(fd, 'notes') })
    const { error } = await c.supabase.from('leave_records').insert({ ...v, employee_id: id, company_id: c.company.id }); if (error) throw error
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Leave recorded.' }
  })
}
export async function uploadPhoto(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const c = await getCtx(); need(c, 'records.edit')
    const f = fd.get('photo'); if (!(f instanceof File) || !f.size) return { error: 'Choose an image.' }
    const buf = new Uint8Array(await f.arrayBuffer())
    const chk = validateUpload({ name: f.name, size: f.size, type: f.type }, buf.slice(0, 16))
    if (!chk.ok) return { error: chk.error }; if (!chk.mime.startsWith('image/')) return { error: 'Photos must be JPG, PNG or WEBP.' }
    const path = storagePath(c.company.id, `employee-photos/${id}`, 1, `${sha256Hex(buf).slice(0, 12)}.${chk.ext}`)
    const up = await c.supabase.storage.from('vault').upload(path, buf, { contentType: chk.mime, upsert: false }); if (up.error) return { error: 'Photo upload failed.' }
    const { error } = await c.supabase.from('employees').update({ photo_path: path }).eq('id', id); if (error) throw error
    revalidatePath(`/employees/${id}`); return { ok: true, message: 'Photo updated.' }
  })
}
