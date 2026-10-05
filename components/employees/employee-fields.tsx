import { Field, Input, Select, Textarea } from '@/components/ui/primitives'

export const EMP_STATUS = ['active', 'on_leave', 'probation', 'resigned', 'terminated', 'archived']

export function EmployeeFields({ d = {}, withSalary }: { d?: Record<string, any>; withSalary?: boolean }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Employee ID *"><Input name="employee_no" defaultValue={d.employee_no} required maxLength={30} placeholder="E-001" /></Field>
    <Field label="Full name *"><Input name="full_name" defaultValue={d.full_name} required /></Field>
    <Field label="Nationality"><Input name="nationality" defaultValue={d.nationality} /></Field>
    <Field label="Department"><Input name="department" defaultValue={d.department} list="depts" /><datalist id="depts"><option>Fabrication</option><option>Welding</option><option>Site</option><option>Office</option><option>Drivers</option></datalist></Field>
    <Field label="Job designation"><Input name="designation" defaultValue={d.designation} /></Field>
    <Field label="Status"><Select name="status" defaultValue={d.status ?? 'active'}>{EMP_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
    <Field label="Contact number"><Input name="phone" defaultValue={d.phone} inputMode="tel" placeholder="050 123 4567" /></Field>
    <Field label="Joining date"><Input type="date" name="joining_date" defaultValue={d.joining_date} /></Field>
    <Field label="Emergency contact name"><Input name="emergency_contact_name" defaultValue={d.emergency_contact_name} /></Field>
    <Field label="Emergency contact number"><Input name="emergency_contact_phone" defaultValue={d.emergency_contact_phone} inputMode="tel" /></Field>
    <Field label="Assigned work location"><Input name="work_location" defaultValue={d.work_location} placeholder="Workshop / Site name" /></Field>
    <Field label="Accommodation"><Input name="accommodation" defaultValue={d.accommodation} placeholder="Camp / room (if provided)" /></Field>
    {withSalary && <Field label="Monthly salary (AED)"><Input type="number" name="monthly_salary" min="0" step="0.01" /></Field>}
    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={d.notes} /></Field></div>
}

