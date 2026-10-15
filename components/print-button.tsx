'use client'
import { useEffect, useRef } from 'react'
import { Printer } from '@/components/icons'
import { Button } from '@/components/ui/primitives'

const loaded = (img: HTMLImageElement) => new Promise<void>(res => {
  if (img.complete) return res()
  img.addEventListener('load', () => res(), { once: true }); img.addEventListener('error', () => res(), { once: true })
})
/**
 * Prints only once the page is really ready: fonts loaded and every image (letterhead, logo, seal, signature, footer)
 * downloaded and decoded at full resolution. A fixed delay could print a half-loaded seal or a blank letterhead.
 */
export async function printWhenReady(timeoutMs = 8000) {
  const imgs = Array.from(document.images)
  const ready = Promise.all([
    document.fonts?.ready,
    ...imgs.map(img => loaded(img).then(() => (img.naturalWidth ? img.decode().catch(() => undefined) : undefined))),
  ])
  await Promise.race([ready, new Promise(r => setTimeout(r, timeoutMs))])
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))   // let layout settle after the last image
  window.print()
}

export function PrintButton({ auto }: { auto?: boolean }) {
  const done = useRef(false)
  useEffect(() => { if (auto && !done.current) { done.current = true; void printWhenReady() } }, [auto])
  return <Button variant="secondary" onClick={() => void printWhenReady(4000)} className="no-print"><Printer size={15} />Print / save as PDF</Button>
}
