'use client'
import { useEffect, useRef, useTransition, type InputHTMLAttributes } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * A search box inside a GET filter form that updates the results shortly after typing stops, without reloading the
 * page (the cursor stays in the box). Enter still submits the form as before. Paging restarts at page 1.
 */
export function LiveSearch({ delay = 450, ...props }: InputHTMLAttributes<HTMLInputElement> & { delay?: number }) {
  const ref = useRef<HTMLInputElement>(null), timer = useRef<number | undefined>(undefined)
  const router = useRouter(), pathname = usePathname(), [pending, start] = useTransition()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <input ref={ref} type="search" autoComplete="off" aria-busy={pending || undefined} data-live-search {...props}
    onChange={e => {
      props.onChange?.(e)
      window.clearTimeout(timer.current)
      const form = ref.current?.form, v = e.currentTarget.value.trim()
      if (!form || v.length === 1) return   // one letter matches almost everything: wait for more
      timer.current = window.setTimeout(() => {
        const params = new URLSearchParams()
        new FormData(form).forEach((val, key) => { if (typeof val === 'string' && val !== '') params.set(key, val) })
        start(() => router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false }))
      }, delay)
    }} />
}
