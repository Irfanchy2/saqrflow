import { Field, FormSection, Input, Select, Textarea } from '@/components/ui/primitives'
import { LEAD_SOURCES, LEAD_STAGES, LOST_REASONS, PRIORITY, SERVICES, TASK_STATUS, VISIT_STATUS, WO_STATUS } from '@/lib/crm'

type Opt = { id: string; name: string }
const opts = (list: Opt[], none = 'Not set') => [<option key="" value="">{none}</option>, ...list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)]

/** Lead add / edit. Contact first (what the salesperson has on the phone), then the opportunity. */
export function LeadFields({ l = {}, users }: { l?: Record<string, any>; users: Opt[] }) {
  return <div className="space-y-5">
    <FormSection title="Customer"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Customer / company name *" className="sm:col-span-2"><Input name="company_name" required maxLength={200} defaultValue={l.company_name} placeholder="e.g. Al Noor Villas LLC or the person’s name" /></Field>
      <Field label="Contact person"><Input name="contact_person" maxLength={120} defaultValue={l.contact_person ?? ''} /></Field>
      <Field label="Phone"><Input name="phone" type="tel" maxLength={40} defaultValue={l.phone ?? ''} inputMode="tel" placeholder="+971 50 123 4567" /></Field>
      <Field label="WhatsApp" hint="Leave blank if the same as phone"><Input name="whatsapp" type="tel" maxLength={40} defaultValue={l.whatsapp ?? ''} inputMode="tel" /></Field>
      <Field label="Email"><Input name="email" type="email" maxLength={200} defaultValue={l.email ?? ''} /></Field>
      <Field label="Location / site" hint="Area or Google Maps link"><Input name="location" maxLength={300} defaultValue={l.location ?? ''} placeholder="e.g. Al Barsha 2, Dubai" /></Field>
      <Field label="TRN" hint="15 digits, if the customer is VAT registered"><Input name="trn" maxLength={20} defaultValue={l.trn ?? ''} inputMode="numeric" className="font-mono" /></Field>
      <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} maxLength={1000} defaultValue={l.address ?? ''} /></Field>
    </div></FormSection>
    <FormSection title="Opportunity"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Service required"><Input name="service" maxLength={300} defaultValue={l.service ?? ''} list="lead-services" placeholder="e.g. Staircase with glass balustrade" /><datalist id="lead-services">{SERVICES.map(s => <option key={s} value={s} />)}</datalist></Field>
      <Field label="Lead source"><Select name="source" defaultValue={l.source ?? 'other'}>{Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Estimated value (AED)" hint="Excluding VAT. Leave blank if unknown"><Input name="estimated_value" type="number" min={0} step="0.01" defaultValue={l.estimated_value ?? ''} inputMode="decimal" /></Field>
      <Field label="Probability %" hint="Blank uses the stage default"><Input name="probability" type="number" min={0} max={100} step={5} defaultValue={l.probability ?? ''} inputMode="numeric" /></Field>
      <Field label="Expected closing date"><Input name="expected_close" type="date" defaultValue={l.expected_close ?? ''} /></Field>
      <Field label="Next follow-up" hint="You get a reminder on this date"><Input name="next_followup" type="date" defaultValue={l.next_followup ?? ''} /></Field>
      <Field label="Assigned salesperson"><Select name="salesperson_id" defaultValue={l.salesperson_id ?? ''}>{opts(users, 'Me')}</Select></Field>
      <Field label="Stage"><Select name="stage" defaultValue={l.stage ?? 'new'}>{LEAD_STAGES.filter(s => l.id || s.key !== 'lost').map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
      {l.id && <>
        <Field label="Lost reason" hint="Required when the stage is Lost"><Select name="lost_reason" defaultValue={l.lost_reason ?? ''}><option value="">Not lost</option>{Object.entries(LOST_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Lost note"><Input name="lost_note" maxLength={500} defaultValue={l.lost_note ?? ''} placeholder="e.g. Competitor quoted 12% lower" /></Field>
      </>}
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={3} maxLength={4000} defaultValue={l.notes ?? ''} /></Field>
    </div></FormSection>
  </div>
}

/** Site visit schedule + findings. On a phone the findings fields are the ones the engineer fills on site. */
export function VisitFields({ v = {}, leads, customers, projects, employees, fixed }: { v?: Record<string, any>; leads: Opt[]; customers: Opt[]; projects: Opt[]; employees: Opt[]; fixed?: { lead_id?: string; customer_id?: string; project_id?: string } }) {
  const f = fixed ?? {}
  return <div className="space-y-5">
    <FormSection title="Visit"><div className="grid gap-4 sm:grid-cols-2">
      {f.lead_id ? <input type="hidden" name="lead_id" value={f.lead_id} /> : <Field label="Lead"><Select name="lead_id" defaultValue={v.lead_id ?? ''}>{opts(leads, 'None')}</Select></Field>}
      {f.customer_id ? <input type="hidden" name="customer_id" value={f.customer_id} /> : <Field label="Customer"><Select name="customer_id" defaultValue={v.customer_id ?? ''}>{opts(customers, 'None')}</Select></Field>}
      {f.project_id ? <input type="hidden" name="project_id" value={f.project_id} /> : <Field label="Project"><Select name="project_id" defaultValue={v.project_id ?? ''}>{opts(projects, 'None')}</Select></Field>}
      <Field label="Site location"><Input name="location" maxLength={300} defaultValue={v.location ?? ''} placeholder="Filled from the lead when blank" /></Field>
      <Field label="Date *"><Input name="scheduled_date" type="date" required defaultValue={v.scheduled_date ?? ''} /></Field>
      <Field label="Time"><Input name="scheduled_time" type="time" defaultValue={v.scheduled_time?.slice(0, 5) ?? ''} /></Field>
      <Field label="Assigned employee"><Select name="employee_id" defaultValue={v.employee_id ?? ''}>{opts(employees)}</Select></Field>
      <Field label="Status"><Select name="status" defaultValue={v.status ?? 'scheduled'}>{Object.entries(VISIT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
      <Field label="Site contact"><Input name="contact_person" maxLength={120} defaultValue={v.contact_person ?? ''} /></Field>
      <Field label="Contact phone"><Input name="contact_phone" type="tel" maxLength={40} defaultValue={v.contact_phone ?? ''} inputMode="tel" /></Field>
      <Field label="Attendees" className="sm:col-span-2"><Input name="attendees" maxLength={500} defaultValue={v.attendees ?? ''} placeholder="Who attended from both sides" /></Field>
    </div></FormSection>
    <FormSection title="Findings" sub="Filled on site or after the visit. Printed on the visit report"><div className="grid gap-4">
      <Field label="Customer requirements"><Textarea name="requirements" rows={3} maxLength={4000} defaultValue={v.requirements ?? ''} /></Field>
      <Field label="Measurements"><Textarea name="measurements" rows={3} maxLength={4000} defaultValue={v.measurements ?? ''} placeholder="e.g. Stair width 1,100 mm · floor-to-floor 3,250 mm · 17 risers" /></Field>
      <Field label="Site notes"><Textarea name="notes" rows={3} maxLength={4000} defaultValue={v.notes ?? ''} placeholder="Access, power, working hours, hazards…" /></Field>
      <Field label="Recommendations"><Textarea name="recommendations" rows={2} maxLength={4000} defaultValue={v.recommendations ?? ''} /></Field>
      <Field label="Follow-up action"><Input name="followup_action" maxLength={1000} defaultValue={v.followup_action ?? ''} placeholder="e.g. Send quotation by Thursday" /></Field>
    </div></FormSection>
  </div>
}

export function WorkOrderFields({ w = {}, customers, projects, users, fixedProject }: { w?: Record<string, any>; customers: Opt[]; projects: Opt[]; users: Opt[]; fixedProject?: string }) {
  return <div className="space-y-5">
    <FormSection title="Job"><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Title *" className="sm:col-span-2"><Input name="title" required maxLength={200} defaultValue={w.title} placeholder="e.g. Fabricate and install main staircase" /></Field>
      {fixedProject ? <input type="hidden" name="project_id" value={fixedProject} /> : <Field label="Project"><Select name="project_id" defaultValue={w.project_id ?? ''}>{opts(projects, 'None')}</Select></Field>}
      <Field label="Customer" hint={fixedProject ? 'Taken from the project when blank' : undefined}><Select name="customer_id" defaultValue={w.customer_id ?? ''}>{opts(customers, 'None')}</Select></Field>
      {w.quotation_id && <input type="hidden" name="quotation_id" value={w.quotation_id} />}
      <Field label="Site location"><Input name="site_location" maxLength={300} defaultValue={w.site_location ?? ''} /></Field>
      <Field label="Responsible manager"><Select name="manager_id" defaultValue={w.manager_id ?? ''}>{opts(users, 'Me')}</Select></Field>
      <Field label="Start date"><Input name="start_date" type="date" defaultValue={w.start_date ?? ''} /></Field>
      <Field label="Target completion"><Input name="target_date" type="date" defaultValue={w.target_date ?? ''} /></Field>
      <Field label="Priority"><Select name="priority" defaultValue={w.priority ?? 'normal'}>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</Select></Field>
      <Field label="Status"><Select name="status" defaultValue={w.status ?? 'pending'}>{Object.entries(WO_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
    </div></FormSection>
    <FormSection title="Scope & instructions"><div className="grid gap-4">
      <Field label="Scope of work"><Textarea name="scope" rows={4} maxLength={8000} defaultValue={w.scope ?? ''} /></Field>
      <Field label="Required equipment" hint="Link company vehicles and machines on the work order page"><Textarea name="equipment" rows={2} maxLength={2000} defaultValue={w.equipment ?? ''} placeholder="e.g. Welding machine, generator, scaffolding, crane truck" /></Field>
      <Field label="Special instructions"><Textarea name="instructions" rows={2} maxLength={4000} defaultValue={w.instructions ?? ''} placeholder="Site access, safety, working hours…" /></Field>
    </div></FormSection>
  </div>
}

export function TaskFields({ t = {}, users, employees, projects, fixed, canAssign = true }: { t?: Record<string, any>; users: Opt[]; employees: Opt[]; projects: Opt[]; fixed?: { project_id?: string; work_order_id?: string; related_type?: string; related_id?: string }; canAssign?: boolean }) {
  const f = fixed ?? {}
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Task *" className="sm:col-span-2"><Input name="title" required maxLength={200} defaultValue={t.title} placeholder="e.g. Cut and weld stringers" /></Field>
    {f.project_id ? <input type="hidden" name="project_id" value={f.project_id} /> : <Field label="Project"><Select name="project_id" defaultValue={t.project_id ?? ''}>{opts(projects, 'None')}</Select></Field>}
    {f.work_order_id && <input type="hidden" name="work_order_id" value={f.work_order_id} />}
    {(f.related_type ?? t.related_type) && <><input type="hidden" name="related_type" value={f.related_type ?? t.related_type} /><input type="hidden" name="related_id" value={f.related_id ?? t.related_id} /></>}
    {canAssign ? <Field label="Assigned to (user)" hint="Gets an in-app notification"><Select name="owner_id" defaultValue={t.owner_id ?? ''}>{opts(users, 'Me')}</Select></Field> : <input type="hidden" name="owner_id" value={t.owner_id ?? ''} />}
    <Field label="Worker / employee" hint="Field staff without a login"><Select name="employee_id" defaultValue={t.employee_id ?? ''}>{opts(employees)}</Select></Field>
    <Field label="Start date"><Input name="start_date" type="date" defaultValue={t.start_date ?? ''} /></Field>
    <Field label="Due date"><Input name="due_date" type="date" defaultValue={t.due_date ?? ''} /></Field>
    <Field label="Priority"><Select name="priority" defaultValue={t.priority ?? 'normal'}>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</Select></Field>
    <Field label="Status"><Select name="status" defaultValue={t.status ?? 'todo'}>{Object.entries(TASK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
    <Field label="Completion %"><Input name="completion" type="number" min={0} max={100} step={5} defaultValue={t.completion ?? 0} inputMode="numeric" /></Field>
    <Field label="Details" className="sm:col-span-2"><Textarea name="description" rows={3} maxLength={4000} defaultValue={t.description ?? ''} /></Field>
  </div>
}

export function SiteReportFields({ r = {}, projects, workOrders, employees, attendance = [], today, fixedProject }: { r?: Record<string, any>; projects: Opt[]; workOrders: Opt[]; employees: Opt[]; attendance?: string[]; today: string; fixedProject?: string }) {
  const present = new Set(attendance)
  return <div className="space-y-5">
    <FormSection title="Report"><div className="grid gap-4 sm:grid-cols-2">
      {fixedProject ? <input type="hidden" name="project_id" value={fixedProject} /> : <Field label="Project *"><Select name="project_id" required defaultValue={r.project_id ?? ''}>{[<option key="" value="">Choose…</option>, ...projects.map(o => <option key={o.id} value={o.id}>{o.name}</option>)]}</Select></Field>}
      <Field label="Work order"><Select name="work_order_id" defaultValue={r.work_order_id ?? ''}>{opts(workOrders, 'None')}</Select></Field>
      <Field label="Date *"><Input name="report_date" type="date" required max={today} defaultValue={r.report_date ?? today} /></Field>
      <Field label="Site supervisor"><Select name="supervisor_id" defaultValue={r.supervisor_id ?? ''}>{opts(employees)}</Select></Field>
      <Field label="Site"><Input name="site" maxLength={300} defaultValue={r.site ?? ''} placeholder="From the project when blank" /></Field>
      <Field label="Progress today %" hint="Raises the project’s site progress (never lowers it)"><Input name="progress" type="number" min={0} max={100} step={5} defaultValue={r.progress ?? ''} inputMode="numeric" /></Field>
      <Field label="Weather"><Input name="weather" maxLength={120} defaultValue={r.weather ?? ''} placeholder="e.g. Clear, 41 °C, light wind" /></Field>
    </div></FormSection>
    <FormSection title="Work"><div className="grid gap-4">
      <Field label="Work completed today *"><Textarea name="work_done" required rows={4} maxLength={8000} defaultValue={r.work_done ?? ''} /></Field>
      <Field label="Planned for tomorrow"><Textarea name="work_planned" rows={2} maxLength={4000} defaultValue={r.work_planned ?? ''} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issues"><Textarea name="issues" rows={2} maxLength={4000} defaultValue={r.issues ?? ''} /></Field>
        <Field label="Delays"><Textarea name="delays" rows={2} maxLength={4000} defaultValue={r.delays ?? ''} /></Field>
        <Field label="Safety observations"><Textarea name="safety_notes" rows={2} maxLength={4000} defaultValue={r.safety_notes ?? ''} /></Field>
        <Field label="Customer instructions"><Textarea name="customer_instructions" rows={2} maxLength={4000} defaultValue={r.customer_instructions ?? ''} /></Field>
        <Field label="Materials delivered to site"><Textarea name="materials_delivered" rows={2} maxLength={4000} defaultValue={r.materials_delivered ?? ''} /></Field>
        <Field label="Equipment used"><Textarea name="equipment_used" rows={2} maxLength={2000} defaultValue={r.equipment_used ?? ''} /></Field>
      </div>
      <Field label="Other notes"><Textarea name="notes" rows={2} maxLength={4000} defaultValue={r.notes ?? ''} /></Field>
    </div></FormSection>
    {employees.length > 0 && <FormSection title="Attendance" sub="Who was on site today">
      <fieldset className="relative grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2"><legend className="sr-only">Employees on site</legend>
        {employees.map(e => <label key={e.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-surface-2"><input type="checkbox" name="attendance" value={e.id} defaultChecked={present.has(e.id)} className="h-4 w-4" />{e.name}</label>)}
      </fieldset></FormSection>}
  </div>
}
