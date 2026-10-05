import { Planned } from '@/components/layout/planned'
export const metadata = { title: 'Vehicles & Assets' }
export default function Page() {
  return <Planned title="Vehicles & Assets" phase="Phase 2" summary="Vehicle registration (Mulkiya), motor insurance, machinery maintenance, warranties and equipment assignments with automatic renewal reminders. The assets table exists; the UI is not built."
    items={['Vehicles with Mulkiya & insurance expiry', 'Machinery maintenance schedules', 'Warranty & inspection certificates', 'Assignment to employees / projects']}
    meanwhile="In the meantime, track vehicle papers as documents in the Document Vault and add custom reminders for services." />
}
