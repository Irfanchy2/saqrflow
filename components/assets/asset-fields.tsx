import { Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { ASSET_CATEGORIES, ASSET_STATUS, EMIRATES, EQUIPMENT_KINDS, VEHICLE_TYPES } from '@/lib/assets'

type Opt = { id: string; full_name: string }
/** Add / edit form fields. Vehicles and equipment share one table; the relevant fields are shown for each. */
export function AssetFields({ kind, a = {}, employees, suppliers }: { kind: 'vehicle' | 'asset'; a?: Record<string, any>; employees: Opt[]; suppliers: string[] }) {
  const v = kind === 'vehicle'
  const status = <Field label="Status"><Select name="status" defaultValue={a.status ?? 'active'}>{Object.entries(ASSET_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
  const assigned = <Field label={v ? 'Assigned employee' : 'Assigned to'}><Select name="assigned_to" defaultValue={a.assigned_to ?? ''}><option value="">— Not assigned —</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
  return <div className="grid gap-4 sm:grid-cols-2">
    {v ? <>
      <input type="hidden" name="kind" value="vehicle" />
      <Field label="Vehicle name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={a.name} placeholder="e.g. Nissan Pickup – workshop" /></Field>
      <Field label="Plate number"><Input name="plate_or_serial" maxLength={60} defaultValue={a.plate_or_serial ?? ''} placeholder="e.g. K 45821" /></Field>
      <Field label="Plate emirate"><Select name="plate_emirate" defaultValue={a.plate_emirate ?? ''}><option value="">—</option>{EMIRATES.map(e => <option key={e}>{e}</option>)}</Select></Field>
      <Field label="Vehicle type"><Select name="vehicle_type" defaultValue={a.vehicle_type ?? ''}><option value="">—</option>{VEHICLE_TYPES.map(e => <option key={e}>{e}</option>)}</Select></Field>
      <Field label="Make"><Input name="make" maxLength={60} defaultValue={a.make ?? ''} placeholder="e.g. Nissan" /></Field>
      <Field label="Model"><Input name="model" maxLength={60} defaultValue={a.model ?? ''} placeholder="e.g. Navara" /></Field>
      <Field label="Year"><Input name="model_year" type="number" min={1950} max={2100} defaultValue={a.model_year ?? ''} /></Field>
      <Field label="Registration / Mulkiya no."><Input name="mulkiya_no" maxLength={60} defaultValue={a.mulkiya_no ?? ''} /></Field>
      <Field label="Mulkiya expiry" hint="Reminders are sent before this date"><Input name="registration_expiry" type="date" defaultValue={a.registration_expiry ?? ''} /></Field>
      <Field label="Insurance provider"><Input name="insurance_provider" maxLength={120} defaultValue={a.insurance_provider ?? ''} /></Field>
      <Field label="Insurance expiry"><Input name="insurance_expiry" type="date" defaultValue={a.insurance_expiry ?? ''} /></Field>
      <Field label="Inspection (RTA test) due"><Input name="inspection_expiry" type="date" defaultValue={a.inspection_expiry ?? ''} /></Field>
      <Field label="Next service"><Input name="next_service_date" type="date" defaultValue={a.next_service_date ?? ''} /></Field>
      <Field label="Remind … days before" hint="e.g. 30, 15, 7, 1 — blank = company default"><Input name="reminder_days" defaultValue={(a.reminder_days ?? []).join(', ')} placeholder="30, 15, 7, 1" /></Field>
      {assigned}{status}
    </> : <>
      <Field label="Asset name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={a.name} placeholder="e.g. Lincoln MIG welding machine" /></Field>
      <Field label="Type"><Select name="kind" defaultValue={a.kind ?? 'equipment'}>{Object.entries(EQUIPMENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Category"><Input name="category" list="asset-categories" maxLength={80} defaultValue={a.category ?? ''} placeholder="e.g. Welding Machine" /><datalist id="asset-categories">{ASSET_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></Field>
      <Field label="Asset ID" hint="Your internal tag, unique"><Input name="asset_code" maxLength={40} defaultValue={a.asset_code ?? ''} placeholder="e.g. AST-0012" /></Field>
      <Field label="Serial number"><Input name="serial_no" maxLength={80} defaultValue={a.serial_no ?? ''} /></Field>
      <Field label="Purchase date"><Input name="purchase_date" type="date" defaultValue={a.purchase_date ?? ''} /></Field>
      <Field label="Purchase price (AED)"><Input name="purchase_price" type="number" min={0} step="0.01" defaultValue={a.purchase_price ?? ''} /></Field>
      <Field label="Supplier"><Input name="supplier_name" list="asset-suppliers" maxLength={200} defaultValue={a.supplier_name ?? ''} /><datalist id="asset-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist></Field>
      <Field label="Location"><Input name="location" maxLength={200} defaultValue={a.location ?? ''} placeholder="e.g. Workshop – Musaffah" /></Field>
      <Field label="Warranty expiry"><Input name="warranty_expiry" type="date" defaultValue={a.warranty_expiry ?? ''} /></Field>
      <Field label="Maintenance due"><Input name="next_service_date" type="date" defaultValue={a.next_service_date ?? ''} /></Field>
      <Field label="Remind … days before" hint="blank = company default"><Input name="reminder_days" defaultValue={(a.reminder_days ?? []).join(', ')} placeholder="30, 7, 1" /></Field>
      {assigned}{status}
    </>}
    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" maxLength={4000} defaultValue={a.notes ?? ''} /></Field>
  </div>
}
