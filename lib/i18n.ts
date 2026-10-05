// Shell-level localisation scaffold. English is complete; Arabic (RTL) and Bengali cover navigation and chrome only.
export const LOCALES = ['en', 'ar', 'bn'] as const
export type Locale = (typeof LOCALES)[number]
export const isRtl = (l: string) => l === 'ar'
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ar: 'العربية', bn: 'বাংলা' }

type Key = 'inbox' | 'overview' | 'documents' | 'employees' | 'vault' | 'cheques' | 'invoices' | 'projects' | 'parties' | 'assets' | 'reminders' | 'calendar' | 'reports' | 'assistant' | 'users' | 'settings' | 'search' | 'signout'
const dict: Record<Locale, Record<Key, string>> = {
  en: { inbox: 'Smart Inbox', overview: 'Overview', documents: 'Company Documents', employees: 'Employees & Labour', vault: 'Document Vault', cheques: 'Banking & Cheques', invoices: 'Sales & Invoices', projects: 'Projects', parties: 'Clients & Suppliers', assets: 'Vehicles & Assets', reminders: 'Smart Reminders', calendar: 'Calendar', reports: 'Reports & Analytics', assistant: 'AI Assistant', users: 'User Management', settings: 'Settings', search: 'Search documents, people, cheques…', signout: 'Sign out' },
  ar: { inbox: 'صندوق المستندات الذكي', overview: 'نظرة عامة', documents: 'مستندات الشركة', employees: 'الموظفون والعمالة', vault: 'خزنة المستندات', cheques: 'البنوك والشيكات', invoices: 'الفواتير والمدفوعات', projects: 'المشاريع', parties: 'العملاء والموردون', assets: 'المركبات والأصول', reminders: 'التذكيرات الذكية', calendar: 'التقويم', reports: 'التقارير والتحليلات', assistant: 'المساعد الذكي', users: 'إدارة المستخدمين', settings: 'الإعدادات', search: 'ابحث في المستندات والأشخاص والشيكات…', signout: 'تسجيل الخروج' },
  bn: { inbox: 'স্মার্ট ইনবক্স', overview: 'ওভারভিউ', documents: 'কোম্পানির নথি', employees: 'কর্মী ও শ্রমিক', vault: 'ডকুমেন্ট ভল্ট', cheques: 'ব্যাংক ও চেক', invoices: 'ইনভয়েস ও পেমেন্ট', projects: 'প্রজেক্ট', parties: 'ক্লায়েন্ট ও সরবরাহকারী', assets: 'যানবাহন ও সম্পদ', reminders: 'স্মার্ট রিমাইন্ডার', calendar: 'ক্যালেন্ডার', reports: 'রিপোর্ট ও বিশ্লেষণ', assistant: 'এআই সহকারী', users: 'ইউজার ম্যানেজমেন্ট', settings: 'সেটিংস', search: 'নথি, ব্যক্তি, চেক খুঁজুন…', signout: 'সাইন আউট' },
}
export const t = (l: string, k: Key) => dict[(LOCALES as readonly string[]).includes(l) ? (l as Locale) : 'en'][k]
