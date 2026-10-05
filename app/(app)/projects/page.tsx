import { Planned } from '@/components/layout/planned'
export const metadata = { title: 'Projects' }
export default function Page() {
  return <Planned title="Projects" phase="Phase 2" summary="Project management for steel fabrication & contracting. The projects table exists; the module UI is not built."
    items={['Contract value, client, location, manager, dates', 'Drawings, quotations, POs, photos', 'Site & fabrication progress, labour assignment', 'Material purchases and variation orders', 'Payment progress & profitability', 'Milestone reminders']} />
}
