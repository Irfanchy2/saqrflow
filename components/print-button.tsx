'use client'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
export const PrintButton = () => <Button variant="secondary" onClick={() => window.print()} className="no-print"><Printer size={15} />Print / save as PDF</Button>
