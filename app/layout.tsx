import './globals.css'
import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { isRtl } from '@/lib/i18n'

export const metadata: Metadata = {
  title: { default: 'Averiqo Business OS', template: '%s · Averiqo' },
  description: 'Averiqo runs quotations, invoices, projects, documents, employees, vehicles and renewals for UAE businesses.',
  applicationName: 'Averiqo',
}
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f7f8fa' }, { media: '(prefers-color-scheme: dark)', color: '#111318' }], width: 'device-width', initialScale: 1, viewportFit: 'cover' }

const themeScript = `try{var t=localStorage.getItem('sf-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get('sf-locale')?.value ?? 'en'
  return <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>{children}</body></html>
}
