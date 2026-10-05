import './globals.css'
import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { isRtl } from '@/lib/i18n'

export const metadata: Metadata = { title: { default: 'SaqrFlow — Smart Business Manager', template: '%s · SaqrFlow' }, description: 'Documents, employees, cheques and renewal reminders for UAE businesses.' }
export const viewport: Viewport = { themeColor: '#2563eb', width: 'device-width', initialScale: 1 }

const themeScript = `try{var t=localStorage.getItem('sf-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get('sf-locale')?.value ?? 'en'
  return <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>{children}</body></html>
}
