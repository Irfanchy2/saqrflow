export const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
export const adminConfigured = () => supabaseConfigured() && !!process.env.SUPABASE_SERVICE_ROLE_KEY
