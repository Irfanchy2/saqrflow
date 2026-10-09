import type { NextRequest } from 'next/server'
import { getResource } from '@/lib/api'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string; id: string }> }) { const p = await params; return getResource(req, p.resource, p.id) }
