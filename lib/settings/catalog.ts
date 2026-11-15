// Settings Hub catalog: every existing settings section, the category it lives in, who may see it and the words people
// search for. One list drives the hub cards, the category pages, the search index and the redirect of old
// /settings#section links, so nothing can be shown in one place and forgotten in another.
// Plain data (no server code): the search box imports the types; visibility is decided on the server.

export type CategoryId = 'company' | 'documents' | 'sales' | 'whatsapp' | 'team' | 'notifications' | 'security' | 'appearance' | 'integrations' | 'data'
export type IconName = 'Building2' | 'Palette' | 'FileText' | 'WhatsApp' | 'Users' | 'Bell' | 'ShieldCheck' | 'Sun' | 'Plug' | 'DatabaseBackup'

/** What the signed-in user may do (from Ctx.can), enough to decide which settings they see. */
export interface SettingsPerms { admin: boolean; users: boolean; audit: boolean; trash: boolean }
type Rule = 'admin' | 'all'

export interface SectionDef { id: string; title: string; keywords: string[]; who: Rule }
export interface LinkDef { href: string; title: string; desc: string; keywords: string[]; who: keyof SettingsPerms }
export interface CategoryDef { id: CategoryId; title: string; short: string; desc: string; icon: IconName; sections: SectionDef[]; links?: LinkDef[] }

export const CATEGORIES: CategoryDef[] = [
  { id: 'company', title: 'Company profile', short: 'Company', icon: 'Building2',
    desc: 'Legal name, trade name and the Arabic name for the PAID stamp.',
    sections: [
      { id: 'company', title: 'Company, tax & currency', who: 'admin', keywords: ['company name', 'legal name', 'business name', 'trade name', 'arabic name', 'name in arabic', 'paid stamp', 'time zone', 'currency', 'company information', 'business identity'] },
    ] },
  { id: 'documents', title: 'Document branding & layout', short: 'Branding', icon: 'Palette',
    desc: 'Letterhead, logo, stamp, signature, contact details, VAT and how documents look.',
    sections: [
      { id: 'branding', title: 'Document branding & sales defaults', who: 'admin', keywords: ['letterhead', 'logo', 'company logo', 'header', 'footer', 'company stamp', 'seal', 'signature', 'signatory', 'designation', 'vat rate', 'trn', 'tax registration', 'address', 'phone', 'email', 'website', 'contact details', 'brand colour', 'brand color', 'bank details', 'iban', 'invoice due days', 'quote validity', 'quotation opening', 'closing note', 'default terms', 'default payment terms', 'follow-up reminders', 'pre-printed paper', 'logo position', 'logo height', 'quotation vat'] },
      { id: 'builder', title: 'Template builder', who: 'admin', keywords: ['template builder', 'document layout', 'pdf template', 'column names', 'document title', 'footer note', 'show bank details', 'amount in words', 'computer generated', 'quotation layout', 'invoice layout', 'delivery note layout'] },
    ] },
  { id: 'sales', title: 'Quotations, invoices & delivery notes', short: 'Sales documents', icon: 'FileText',
    desc: 'Document numbering and reusable terms & payment terms.',
    sections: [
      { id: 'numbering', title: 'Document numbering', who: 'admin', keywords: ['numbering', 'document number', 'invoice number', 'quotation number', 'delivery note number', 'purchase order number', 'prefix', 'running number', 'number format', 'serial'] },
      { id: 'templates', title: 'Terms templates', who: 'admin', keywords: ['terms templates', 'terms and conditions', 'terms & conditions', 'payment terms', 'default notes', 'steel fabrication', 'installation', 'supply only', 'maintenance', 'project contract'] },
    ] },
  { id: 'whatsapp', title: 'WhatsApp & sharing', short: 'WhatsApp', icon: 'WhatsApp',
    desc: 'Free WhatsApp PDF sharing messages, Evolution API and the Meta Cloud API.',
    sections: [
      { id: 'wa-share', title: 'WhatsApp sharing messages', who: 'admin', keywords: ['share via whatsapp', 'free whatsapp', 'pdf sharing', 'sharing messages', 'message text', 'payslip message', 'receipt message', 'sharing preferences'] },
      { id: 'evolution', title: 'WhatsApp via Evolution API', who: 'admin', keywords: ['evolution api', 'qr code', 'link number', 'self-hosted', 'whatsapp web', 'whatsapp business number'] },
      { id: 'whatsapp', title: 'WhatsApp Business Platform (Meta Cloud API)', who: 'admin', keywords: ['meta', 'cloud api', 'phone number id', 'access token', 'business account', 'waba', 'webhook', 'sandbox', 'test connection'] },
      { id: 'wa-templates', title: 'WhatsApp message templates', who: 'admin', keywords: ['message templates', 'meta templates', 'template approval', 'placeholders'] },
    ] },
  { id: 'team', title: 'Employees, expenses & approvals', short: 'Team & approvals', icon: 'Users',
    desc: 'Approval rules, the employee portal and company payment cards.',
    sections: [
      { id: 'approvals', title: 'Approvals', who: 'admin', keywords: ['approval rules', 'expense approval', 'expenses threshold', 'cheque approval', 'outgoing cheques', 'purchase order approval', 'quotation approval', 'manager approval'] },
      { id: 'employee-portal', title: 'Employee portal', who: 'admin', keywords: ['employee portal', 'employee login', 'employee self service', 'payslips', 'salary', 'attendance', 'receipts', 'petty cash', 'employee expenses'] },
      { id: 'company-cards', title: 'Company cards', who: 'admin', keywords: ['company cards', 'credit card', 'debit card', 'card payments', 'last 4 digits', 'expenses card'] },
    ] },
  { id: 'notifications', title: 'Notifications & reminders', short: 'Notifications', icon: 'Bell',
    desc: 'Reminder schedule, your own alert rules and scheduled reports.',
    sections: [
      { id: 'notifications', title: 'Notifications and reminder schedule', who: 'admin', keywords: ['reminders', 'reminder schedule', 'document expiry', 'expiry reminders', 'payment reminders', 'days before', 'overdue reminders', 'daily summary', 'digest', 'email fallback', 'notification preferences'] },
      { id: 'rules', title: 'Notification rules', who: 'admin', keywords: ['notification rules', 'alerts', 'events', 'minimum amount', 'notify'] },
      { id: 'schedules', title: 'Scheduled reports', who: 'admin', keywords: ['scheduled reports', 'weekly report', 'monthly report', 'email report', 'summary report', 'collections report'] },
    ] },
  { id: 'security', title: 'Users, roles & security', short: 'Security', icon: 'ShieldCheck',
    desc: 'Two-step verification, signed-in devices, users, permissions and the audit log.',
    sections: [
      { id: 'account', title: 'Your account & security', who: 'all', keywords: ['two-step verification', '2fa', 'mfa', 'authenticator', 'devices', 'sessions', 'sign-in history', 'sign out other devices', 'security', 'my account'] },
    ],
    links: [
      { href: '/users', title: 'Users & permissions', desc: 'Invite people, set roles and what each role may do', who: 'users', keywords: ['users', 'user management', 'roles', 'permissions', 'role permissions', 'access control', 'invite', 'team members'] },
      { href: '/users/activity', title: 'User activity', desc: 'Who signed in and what they changed', who: 'users', keywords: ['user activity', 'login history'] },
      { href: '/audit', title: 'Audit log', desc: 'Every change, with who made it and when', who: 'audit', keywords: ['audit', 'audit log', 'history', 'changes'] },
      { href: '/trash', title: 'Trash', desc: 'Restore deleted records', who: 'trash', keywords: ['trash', 'deleted', 'restore', 'recycle bin'] },
    ] },
  { id: 'appearance', title: 'Appearance & language', short: 'Appearance', icon: 'Sun',
    desc: 'Light or dark mode and the interface language.',
    sections: [
      { id: 'theme', title: 'Theme', who: 'all', keywords: ['theme', 'dark mode', 'light mode', 'system theme', 'appearance', 'display'] },
      { id: 'language', title: 'Interface language', who: 'all', keywords: ['language', 'arabic', 'bengali', 'english', 'right to left', 'rtl', 'locale'] },
    ] },
  { id: 'integrations', title: 'Integrations & advanced', short: 'Integrations', icon: 'Plug',
    desc: 'AI & OCR, API & webhooks, public forms, custom fields and statuses.',
    sections: [
      { id: 'ai', title: 'AI & Automation', who: 'admin', keywords: ['ai', 'ocr', 'receipt reading', 'gemini', 'ocr.space', 'google vision', 'classification', 'smart inbox', 'api key'] },
      { id: 'integrations', title: 'API & webhooks', who: 'admin', keywords: ['api', 'api keys', 'webhooks', 'accounting software', 'automation', 'zapier', 'integration'] },
      { id: 'forms', title: 'Public forms', who: 'admin', keywords: ['public forms', 'enquiry form', 'website form', 'service request', 'qr code', 'leads'] },
      { id: 'custom', title: 'Custom fields & statuses', who: 'admin', keywords: ['custom fields', 'custom statuses', 'extra fields', 'status names'] },
    ] },
  { id: 'data', title: 'Data & backup', short: 'Data', icon: 'DatabaseBackup',
    desc: 'Where your data lives, backups, export and import.',
    sections: [
      { id: 'data', title: 'Data & backup', who: 'all', keywords: ['backup', 'export', 'download data', 'restore', 'import', 'excel export', 'data'] },
    ] },
]

const allowed = (who: Rule, p: SettingsPerms) => who === 'all' || p.admin

/** The categories (with only the sections and links this user may see); empty categories are left out. */
export function visibleCategories(p: SettingsPerms): CategoryDef[] {
  return CATEGORIES.map(c => ({ ...c, sections: c.sections.filter(s => allowed(s.who, p)), links: c.links?.filter(l => p[l.who]) }))
    .filter(c => c.sections.length > 0 || (c.links?.length ?? 0) > 0)
}

/** Old single-page anchors (/settings#branding …) → the category that now holds them. */
export const SECTION_CATEGORY: Record<string, CategoryId> = Object.fromEntries(CATEGORIES.flatMap(c => c.sections.map(s => [s.id, c.id])))
SECTION_CATEGORY.mfa = 'security'

export interface SearchItem { href: string; title: string; category: string; keywords: string[]; kind: 'category' | 'section' | 'link' }

/** The search index for one user: categories, sections and admin pages they are allowed to open. */
export function searchIndex(cats: CategoryDef[]): SearchItem[] {
  return cats.flatMap(c => [
    { href: `/settings/${c.id}`, title: c.title, category: c.title, keywords: [c.short, c.desc], kind: 'category' as const },
    ...c.sections.map(s => ({ href: `/settings/${c.id}#${s.id}`, title: s.title, category: c.title, keywords: s.keywords, kind: 'section' as const })),
    ...(c.links ?? []).map(l => ({ href: l.href, title: l.title, category: c.title, keywords: [...l.keywords, l.desc], kind: 'link' as const })),
  ])
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Ranked matches: every word of the query must appear in the title, category or a keyword. */
export function searchSettings(items: SearchItem[], q: string): (SearchItem & { hit?: string })[] {
  const words = norm(q).split(' ').filter(Boolean)
  if (!words.length) return []
  const out: { item: SearchItem; score: number; hit?: string }[] = []
  for (const it of items) {
    const title = norm(it.title), cat = norm(it.category), kws = it.keywords.map(norm)
    const hay = `${title} ${cat} ${kws.join(' ')}`
    if (!words.every(w => hay.includes(w))) continue
    const phrase = words.join(' '), hit = kws.find(k => k.includes(phrase))
    const score = (title.startsWith(phrase) ? 60 : title.includes(phrase) ? 40 : 0) + (hit ? (hit === phrase ? 30 : 20) : 0) + (it.kind === 'section' ? 6 : it.kind === 'link' ? 4 : -15) + (cat.includes(phrase) ? 3 : 0)
    out.push({ item: it, score, hit: hit && !title.includes(phrase) ? it.keywords[kws.indexOf(hit)] : undefined })
  }
  return out.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title)).slice(0, 12).map(x => ({ ...x.item, hit: x.hit }))
}
