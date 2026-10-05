import { createBrowserClient } from '@supabase/ssr'
import { supabasePublishableKey, supabaseUrl } from '../env'
export const createBrowser = () => createBrowserClient(supabaseUrl(), supabasePublishableKey())
