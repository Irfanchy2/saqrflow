// Supabase settings. Modern key names first (publishable / secret), legacy names (anon / service_role) still work.
// NEXT_PUBLIC_* values are inlined at build time; the secret key is read on the server only.
export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const supabasePublishableKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
export const supabaseSecretKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const supabaseConfigured = () => !!supabaseUrl() && !!supabasePublishableKey()
export const adminConfigured = () => supabaseConfigured() && !!supabaseSecretKey()
