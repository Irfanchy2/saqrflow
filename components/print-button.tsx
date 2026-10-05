'use client'
import { useEffect } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
export function PrintButton({ auto }: { auto?: boolean }) {
  useEffect(() => { if (auto) { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t) } }, [auto])
  return <Button variant="secondary" onClick={() => window.print()} className="no-print"><Printer size={15} />Print / save as PDF</Button>
}
