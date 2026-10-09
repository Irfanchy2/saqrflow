'use client'
import { useEffect, useRef, useState } from 'react'
import { formatNumber } from '@/lib/numbering'

/** Live "next number" preview for a numbering form: reads the enclosing form's fields as they change. */
export function NumberPreview({ initial, year }: { initial: string; year: number }) {
  const ref = useRef<HTMLElement>(null), [text, setText] = useState(initial)
  useEffect(() => {
    const form = ref.current?.closest('form'); if (!form) return
    const update = () => {
      const fd = new FormData(form), g = (k: string) => String(fd.get(k) ?? ''), yf = g('year_format')
      const seq = Math.max(1, Math.floor(Number(g('next_seq')) || 1)), pad = Math.min(10, Math.max(1, Math.floor(Number(g('seq_pad')) || 1)))
      setText(formatNumber({ prefix: g('prefix').trim(), number_separator: g('number_separator'), fixed_digits: g('fixed_digits').trim(), seq_pad: pad, year_separator: g('year_separator'), include_year: yf !== 'none', year_format: yf }, seq, year))
    }
    form.addEventListener('input', update); form.addEventListener('change', update)
    return () => { form.removeEventListener('input', update); form.removeEventListener('change', update) }
  }, [year])
  return <p className="text-sm text-muted">Next number: <code ref={ref} className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg" aria-live="polite">{text}</code></p>
}
