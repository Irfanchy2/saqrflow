'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ICONS, NavDot, type NavItem } from '@/components/layout/sidebar'
import { TabIcon, hasTabIcon } from '@/components/layout/tab-icons'
import { gsapNow, preloadGsap } from '@/lib/gsap-pop'

const SHORT: Record<string, string> = { leads: 'CRM', parties: 'Customers', site_visits: 'Visits', work_orders: 'Orders', site_reports: 'Reports', documents: 'Documents', employees: 'People', assets: 'Assets', expenses: 'Expenses', cheques: 'Cheques', reports: 'Reports', overview: 'Home', catalog: 'Catalog', users: 'Users', vault: 'Vault', inbox: 'Inbox', brief: 'Brief', calendar: 'Calendar', approvals: 'Approvals', reminders: 'Reminders', settings: 'Settings', tickets: 'Service', kb: 'Guides', audit: 'Audit', trash: 'Trash', payments: 'Payments', assistant: 'Assistant', stock: 'Stock', banking: 'Banking' }

/**
 * Phone tab bar: Home, Sales, Projects, Tasks and More (the full menu). When the current page is another module
 * (CRM, Customers, Expenses…) it takes the second slot, so the place you are is always visible. Hidden from lg up.
 *
 * A graphite capsule; the open tab is lit by the blue "arc" that GSAP glides across (it moves the moment you tap, before
 * the page arrives). Every tab shows its name under the icon, so the bar reads without guessing what an icon means.
 * The four tab pages are prefetched while the bar is on screen, so they open without waiting.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  const [want, setWant] = useState<string | null>(null)
  useEffect(() => setWant(null), [path])
  const on = (h: string) => { const b = h.split('?')[0]; return b === '/' ? path === '/' : path === b || path.startsWith(b + '/') }
  const pick = (k: string) => items.find(i => i.key === k)
  const base = [pick('overview'), pick('quotations') && { ...pick('quotations')!, label: 'Sales', href: '/invoices' }, pick('projects'), pick('tasks')].filter(Boolean) as NavItem[]
  const here = items.find(i => !i.tab && i.key !== 'overview' && on(i.href))
  const list = here && !base.some(b => on(b.href)) ? [base[0], here, ...base.slice(1)].slice(0, 4) : base.slice(0, 4)
  const active = want ?? list.find(i => on(i.href))?.key ?? null
  const hidden = items.filter(i => i.alert && !list.some(l => l.key === i.key)).reduce((s, i) => s + (i.alert ?? 0), 0)   // waiting behind "More"

  const bar = useRef<HTMLElement>(null), lamp = useRef<HTMLSpanElement>(null), first = useRef(true)
  useLayoutEffect(() => {
    const place = (animate: boolean) => {
      const l = lamp.current, cell = active ? bar.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`) : null
      if (!l) return
      if (!cell) { l.style.opacity = '0'; return }
      const g = gsapNow(), x = cell.offsetLeft, w = cell.offsetWidth
      if (g && animate) {
        g.to(l, { x, width: w, opacity: 1, duration: 0.55, ease: 'expo.out', overwrite: true })
        g.fromTo(l, { scaleY: 0.84 }, { scaleY: 1, duration: 0.5, ease: 'back.out(3)' })
        const ico = cell.querySelector('svg'), name = cell.querySelector('[data-name]')
        if (ico) g.fromTo(ico, { y: 6, scale: 0.78 }, { y: 0, scale: 1, duration: 0.5, ease: 'back.out(2.2)', clearProps: 'transform' })
        if (name) g.fromTo(name, { autoAlpha: 0, y: 5 }, { autoAlpha: 1, y: 0, duration: 0.3, delay: 0.1, ease: 'power2.out', clearProps: 'opacity,visibility,transform' })
      } else if (g) g.set(l, { x, width: w, opacity: 1 })
      else { l.style.transform = `translateX(${x}px)`; l.style.width = `${w}px`; l.style.opacity = '1' }
    }
    place(!first.current); first.current = false
    const re = () => place(false)
    addEventListener('resize', re); return () => removeEventListener('resize', re)
  }, [active, list.map(i => i.key).join()])

  const cell = 'tab-cell relative z-[1] flex h-[54px] min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-[3px] rounded-[18px] outline-none'
  const icon = (key: string, lit: boolean) => {
    if (hasTabIcon(key)) return <TabIcon name={key} on={lit} className="relative" />
    const I = ICONS[key]; return I ? <I size={22} weight="duotone" aria-hidden className="relative" /> : null
  }
  return <nav ref={bar} aria-label="Quick navigation" onTouchStart={preloadGsap} onPointerEnter={preloadGsap}
    className="capsule no-print fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-nav mx-auto flex max-w-md rounded-[24px] p-[5px] lg:hidden">
    <span ref={lamp} aria-hidden className="arc pointer-events-none absolute left-0 top-[5px] h-[54px] w-0 origin-bottom rounded-[18px] opacity-0" />
    {list.map(i => { const lit = active === i.key
      return <Link key={i.key} href={i.href} prefetch data-tab={i.key} aria-current={on(i.href) ? 'page' : undefined} onClick={() => setWant(i.key)}
        className={cn(cell, lit ? 'text-white' : 'text-[hsl(220_10%_66%)] active:text-white')}>
        <span className="relative">{icon(i.key, lit)}<NavDot n={i.alert} className="absolute -end-1 -top-0.5" /></span>
        <span data-name className="max-w-full truncate px-1 font-tech text-[11px] font-semibold leading-none tracking-[0.02em]">{SHORT[i.key] ?? i.label}</span></Link> })}
    <button type="button" onClick={() => dispatchEvent(new Event('averiqo:menu'))} className={cn(cell, 'text-[hsl(220_10%_66%)] active:text-white')}>
      <span className="relative"><TabIcon name="more" className="relative transition-transform duration-150 active:scale-90" /><NavDot n={hidden} className="absolute -end-1 -top-0.5" /></span><span className="font-tech text-[11px] font-semibold leading-none tracking-[0.02em]">More</span></button>
  </nav>
}
