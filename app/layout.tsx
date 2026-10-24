import './globals.css'
import type { Metadata, Viewport } from 'next'
import { cookies, headers } from 'next/headers'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import localFont from 'next/font/local'
import { isRtl } from '@/lib/i18n'
import { AuthLinkCatcher } from '@/components/auth/link-catcher'

// interface typeface: Urbanist (SIL OFL), served from our own build; Geist stays for printed documents and code
const urbanist = localFont({ src: '../node_modules/@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2', weight: '100 900', variable: '--font-urbanist', display: 'swap' })
// Chakra Petch (Google Fonts, SIL OFL): cut-corner letters like machined steel, only for the phone tab bar and the dashboard clock
const chakra = localFont({ src: [{ path: '../node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2', weight: '500' }, { path: '../node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2', weight: '600' }], variable: '--font-tech', display: 'swap', preload: false })

export const metadata: Metadata = {
  title: { default: 'Averiqo Business OS', template: '%s · Averiqo' },
  description: 'Averiqo runs quotations, invoices, projects, documents, employees, vehicles and renewals for UAE businesses.',
  applicationName: 'Averiqo',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  // the picture shown when a link to Averiqo is shared on WhatsApp, LinkedIn, Slack, X… (public/brand/og.jpg, 1200×630)
  openGraph: { type: 'website', siteName: 'Averiqo', title: 'Averiqo Business OS', description: 'Quotations, invoices, projects, documents, staff and renewals for UAE businesses, in one place.',
    images: [{ url: '/brand/og.jpg', width: 1200, height: 630, alt: 'Averiqo Business OS: dashboard with sales, receivables and tasks' }] },
  twitter: { card: 'summary_large_image', title: 'Averiqo Business OS', description: 'Quotations, invoices, projects, documents, staff and renewals for UAE businesses.', images: ['/brand/og.jpg'] },
}
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#efefec' }, { media: '(prefers-color-scheme: dark)', color: '#131211' }], width: 'device-width', initialScale: 1, viewportFit: 'cover' }

const themeScript = `try{var t=localStorage.getItem('sf-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await cookies()).get('sf-locale')?.value ?? 'en', nonce = (await headers()).get('x-nonce') ?? undefined
  return <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} className={`${urbanist.variable} ${chakra.variable} ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
    <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
    <body>{children}<AuthLinkCatcher /></body></html>
}
