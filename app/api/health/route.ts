import { NextResponse } from 'next/server'
import { supabaseConfigured, adminConfigured } from '@/lib/env'
export const dynamic = 'force-dynamic'
/** Liveness only – reveals no configuration detail beyond booleans. */
export async function GET() { return NextResponse.json({ ok: true, supabase: supabaseConfigured(), admin: adminConfigured() }) }
