'use client'
import { useEffect } from 'react'

/**
 * Older email links put the sign-in in the address after "#" (access_token=…&type=recovery), which the server never sees.
 * When such a link opens any page, this signs the person in from it and continues to the right step: a password reset goes
 * to "Choose a new password"; an expired link says so. Renders nothing.
 */
export function AuthLinkCatcher() {
  useEffect(() => {
    const h = new URLSearchParams(location.hash.slice(1))
    if (h.get('error_code') === 'otp_expired' || (h.get('error') && h.get('error_description'))) { location.replace('/login/reset?expired=1'); return }
    const access_token = h.get('access_token'), refresh_token = h.get('refresh_token')
    if (!access_token || !refresh_token) return
    const type = h.get('type')
    // the browser client is loaded only when such a link was opened (this component is on every page)
    import('@/lib/supabase/browser').then(({ createBrowser }) => createBrowser().auth.setSession({ access_token, refresh_token })).then(({ error }) => {
      if (error) location.replace(type === 'recovery' ? '/login/reset?expired=1' : '/login?link=expired')
      else location.replace(type === 'recovery' ? '/login/reset' : '/')
    })
  }, [])
  return null
}
