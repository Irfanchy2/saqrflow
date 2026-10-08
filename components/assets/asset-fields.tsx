import { Field, FormSection, Input, Select, Textarea } from '@/components/ui/primitives'
import { ASSET_CATEGORIES, ASSET_STATUS, CONDITIONS, EMIRATES, EQUIPMENT_KINDS, VEHICLE_TYPES } from '@/lib/assets'

type Opt = { id: string; full_name: string }
/** Add / edit form fields. Vehicles and equipment share one table; each kind shows the fields that matter for it, in short groups. */
export function AssetFields({ kind, a = {}, employees, suppliers }: { kind: 'vehicle' | 'asset'; a?: Record<string, any>; employees: Opt[]; suppliers: string[] }) {
  const v = kind === 'vehicle'
  const status = <Field label="Status"><Select name="status" defaultValue={a.status ?? 'active'}>{Object.entries(ASSET_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
  const assigned = <Field label={v ? 'Assigned driver' : 'Assigned to'} hint={a.id ? 'Use Assign on the profile to record dates, project and notes' : undefined}><Select name="assigned_to" defaultValue={a.assigned_to ?? ''}><option value="">Not assigned</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
  const reminders = <Field label="Remind days before" hint="e.g. 30, 15, 7, 1. Blank uses the company schedule"><Input name="reminder_days" defaultValue={(a.reminder_days ?? []).join(', ')} placeholder="30, 15, 7, 1" inputMode="numeric" /></Field>
  return <div className="space-y-5">
    {v ? <>
      <input type="hidden" name="kind" value="vehicle" />
      <FormSection title="Vehicle"><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vehicle name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={a.name} placeholder="e.g. Hilux pickup, workshop" /></Field>
        <Field label="Vehicle type"><Select name="vehicle_type" defaultValue={a.vehicle_type ?? ''}><option value="">Choose…</option>{VEHICLE_TYPES.map(e => <option key={e}>{e}</option>)}</Select></Field>
        <Field label="Make"><Input name="make" maxLength={60} defaultValue={a.make ?? ''} placeholder="e.g. Toyota" /></Field>
        <Field label="Model"><Input name="model" maxLength={60} defaultValue={a.model ?? ''} placeholder="e.g. Hilux" /></Field>
        <Field label="Year"><Input name="model_year" type="number" min={1950} max={2100} defaultValue={a.model_year ?? ''} inputMode="numeric" /></Field>
        <Field label="VIN / chassis number"><Input name="vin" maxLength={40} defaultValue={a.vin ?? ''} className="font-mono" /></Field>
        <Field label="Current mileage (km)"><Input name="current_mileage" type="number" min={0} defaultValue={a.current_mileage ?? ''} inputMode="numeric" /></Field>
      </div></FormSection>
      <FormSection title="Registration & insurance" sub="Expiry dates create reminders automatically"><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Plate number"><Input name="plate_or_serial" maxLength={60} defaultValue={a.plate_or_serial ?? ''} placeholder="e.g. K 45821" /></Field>
        <Field label="Plate emirate"><Select name="plate_emirate" defaultValue={a.plate_emirate ?? ''}><option value="">Choose…</option>{EMIRATES.map(e => <option key={e}>{e}</option>)}</Select></Field>
        <Field label="Registration (Mulkiya) number"><Input name="mulkiya_no" maxLength={60} defaultValue={a.mulkiya_no ?? ''} /></Field>
        <Field label="Registration expiry"><Input name="registration_expiry" type="date" defaultValue={a.registration_expiry ?? ''} /></Field>
        <Field label="Insurance company"><Input name="insurance_provider" maxLength={120} defaultValue={a.insurance_provider ?? ''} /></Field>
        <Field label="Insurance expiry"><Input name="insurance_expiry" type="date" defaultValue={a.insurance_expiry ?? ''} /></Field>
        <Field label="Inspection (RTA test) due"><Input name="inspection_expiry" type="date" defaultValue={a.inspection_expiry ?? ''} /></Field>
        {reminders}
      </div></FormSection>
      <FormSection title="Service & use"><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Next service date"><Input name="next_service_date" type="date" defaultValue={a.next_service_date ?? ''} /></Field>
        <Field label="Service every (km)" hint="Next service km = current mileage + interval"><Input name="service_interval_km" type="number" min={100} step={100} defaultValue={a.service_interval_km ?? ''} inputMode="numeric" placeholder="e.g. 10000" /></Field>
        {assigned}{status}
      </div></FormSection>
    </> : <>
      <FormSection title="Asset"><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Asset name *" className="sm:col-span-2"><Input name="name" required maxLength={200} defaultValue={a.name} placeholder="e.g. MIG welding machine" /></Field>
        <Field label="Category"><Input name="category" list="asset-categories" maxLength={80} defaultValue={a.category ?? ''} placeholder="e.g. Welding Machine" /><datalist id="asset-categories">{ASSET_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Type"><Select name="kind" defaultValue={a.kind ?? 'equipment'}>{Object.entries(EQUIPMENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Asset code" hint="Your internal tag, unique"><Input name="asset_code" maxLength={40} defaultValue={a.asset_code ?? ''} placeholder="e.g. AST-0012" className="font-mono" /></Field>
        <Field label="Serial number"><Input name="serial_no" maxLength={80} defaultValue={a.serial_no ?? ''} className="font-mono" /></Field>
        <Field label="Brand"><Input name="make" maxLength={60} defaultValue={a.make ?? ''} placeholder="e.g. Lincoln Electric" /></Field>
        <Field label="Model"><Input name="model" maxLength={60} defaultValue={a.model ?? ''} /></Field>
      </div></FormSection>
      <FormSection title="Purchase"><div className="grid gap-4 sm:grid-cols-3">
        <Field label="Purchase date"><Input name="purchase_date" type="date" defaultValue={a.purchase_date ?? ''} /></Field>
        <Field label="Purchase price (AED)"><Input name="purchase_price" type="number" min={0} step="0.01" defaultValue={a.purchase_price ?? ''} inputMode="decimal" /></Field>
        <Field label="Supplier"><Input name="supplier_name" list="asset-suppliers" maxLength={200} defaultValue={a.supplier_name ?? ''} /><datalist id="asset-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist></Field>
      </div></FormSection>
      <FormSection title="Location, condition & maintenance"><div className="grid gap-4 sm:grid-cols-2">
        {assigned}
        <Field label="Current location"><Input name="location" maxLength={200} defaultValue={a.location ?? ''} placeholder="e.g. Workshop, Musaffah" /></Field>
        <Field label="Condition"><Select name="condition" defaultValue={a.condition ?? ''}><option value="">Not recorded</option>{Object.entries(CONDITIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {status}
        <Field label="Warranty expiry"><Input name="warranty_expiry" type="date" defaultValue={a.warranty_expiry ?? ''} /></Field>
        <Field label="Next maintenance"><Input name="next_service_date" type="date" defaultValue={a.next_service_date ?? ''} /></Field>
        {reminders}
      </div></FormSection>
    </>}
    <FormSection title="Notes"><Textarea name="notes" maxLength={4000} defaultValue={a.notes ?? ''} aria-label="Notes" /></FormSection>
  </div>
}
