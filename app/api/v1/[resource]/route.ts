import type { NextRequest } from 'next/server'
import { listResource } from '@/lib/api'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest, { params }: { params: Promise<{ resource: string }> }) { return listResource(req, (await params).resource) }
