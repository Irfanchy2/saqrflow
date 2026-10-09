// Readable, redacted summaries of audit_logs rows. Secrets, ID numbers and money of a personal nature are never shown.
export const TABLE_LABEL: Record<string, string> = {
  invoices: 'Sales document', invoice_items: 'Sales line', payments: 'Payment', customers: 'Customer', suppliers: 'Supplier', projects: 'Project',
  project_expenses: 'Expense', project_milestones: 'Milestone', cheques: 'Cheque', documents: 'Document', document_versions: 'Document file', employees: 'Employee',
  employee_compensation: 'Salary', salary_payments: 'Salary payment', employee_advances: 'Advance', assets: 'Vehicle / asset', asset_maintenance: 'Maintenance',
  app_settings: 'Setting', profiles: 'User', companies: 'Company', reminders: 'Reminder', notification_recipients: 'Notification recipient',
  catalog_items: 'Catalog item', terms_templates: 'Terms template', sales_followups: 'Follow-up', sales_doc_revisions: 'Revision', banks: 'Bank', document_number_formats: 'Numbering',
  tasks: 'Task', leads: 'Lead', work_orders: 'Work order', site_visits: 'Site visit', daily_site_reports: 'Site report', approval_requests: 'Approval',
  custom_field_values: 'Custom fields', custom_field_defs: 'Custom field', custom_statuses: 'Custom status',
}
export const ACTION_LABEL: Record<string, string> = { INSERT: 'Created', UPDATE: 'Edited', DELETE: 'Deleted', TRASH: 'Moved to trash', RESTORE: 'Restored', PURGE: 'Deleted permanently', EXPORT: 'Exported' }
const SENSITIVE = /token|secret|password|passw|key$|api_?key|iban|account_no|card|salary|monthly_salary|allowance|passport|emirates|eid|national|document_number|id_number|uid_no|labour_card|reference_no|snapshot|value$/i
const NOISE = new Set(['updated_at', 'created_at', 'id', 'company_id', 'revision', 'client_token'])
const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? (Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : '…') : String(v).slice(0, 60))

/** e.g. ["status: draft → sent", "total: 1,000 → 1,050", "notes changed"] */
export function changeSummary(table: string, action: string, changes: any): string[] {
  if (!changes || changes.redacted) return changes?.redacted ? ['details hidden (confidential)'] : []
  if (action === 'EXPORT') return [`${changes.rows ?? '?'} rows`]
  if (action !== 'UPDATE' || !changes.old || !changes.new) {
    const r = changes.new ?? changes
    const name = r.name ?? r.number ?? r.full_name ?? r.title ?? r.description ?? r.key
    return name && !SENSITIVE.test(table === 'app_settings' ? String(r.key) : 'name') ? [String(name).slice(0, 80)] : []
  }
  const out: string[] = []
  const hideAll = table === 'app_settings' || table === 'integration_secrets'
  for (const k of Object.keys(changes.new)) {
    if (NOISE.has(k)) continue
    const a = changes.old[k], b = changes.new[k]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    out.push(hideAll || SENSITIVE.test(k) || (table === 'employees' && !['status', 'designation', 'department', 'full_name'].includes(k)) ? `${k.replace(/_/g, ' ')} changed` : `${k.replace(/_/g, ' ')}: ${fmt(a)} → ${fmt(b)}`)
  }
  if (table === 'app_settings' && changes.new.key) return [`${changes.new.key} changed`]
  return out.slice(0, 8)
}
