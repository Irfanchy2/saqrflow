import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { supabasePublishableKey, supabaseUrl } from '../env'
import { cookies } from 'next/headers'

export async function createClient() {
  const store = await cookies()
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)) } catch { /* called from a Server Component */ } },
    },
  })
}
