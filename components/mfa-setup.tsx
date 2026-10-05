'use client'
import { useEffect, useMemo, useState } from 'react'
import { createBrowser } from '@/lib/supabase/browser'
import { Alert, Button, Field, Input } from '@/components/ui/primitives'

/** Optional TOTP two-step verification using Supabase Auth MFA (enroll → scan → verify). */
export function MfaSetup() {
  const sb = useMemo(() => { try { return createBrowser() } catch { return null } }, [])
  const [state, setState] = useState<'loading' | 'off' | 'enrolling' | 'on'>('loading')
  const [qr, setQr] = useState(''); const [secret, setSecret] = useState(''); const [fid, setFid] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState('')
  const refresh = async () => { if (!sb) return setState('off'); const { data } = await sb.auth.mfa.listFactors(); const f = data?.totp.find(x => x.status === 'verified'); setFid(f?.id ?? ''); setState(f ? 'on' : 'off') }
  useEffect(() => { refresh() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => { if (!sb) return setErr('Authentication is not configured.'); setErr(''); const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' }); if (error) return setErr(error.message); setFid(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setState('enrolling') }
  const verify = async () => { if (!sb) return; setErr(''); const ch = await sb.auth.mfa.challenge({ factorId: fid }); if (ch.error) return setErr(ch.error.message)
    const v = await sb.auth.mfa.verify({ factorId: fid, challengeId: ch.data.id, code: code.replace(/\s/g, '') }); if (v.error) return setErr('That code is not valid.'); setCode(''); refresh() }
  const disable = async () => { if (!sb) return; if (!confirm('Turn off two-step verification?')) return; const { error } = await sb.auth.mfa.unenroll({ factorId: fid }); if (error) setErr(error.message); else refresh() }
  if (state === 'loading') return <div className="skeleton h-9 w-40" />
  return <div className="space-y-3 text-sm">
    {state === 'on' && <><Alert tone="green">Two-step verification is <b>on</b> for your account.</Alert><Button variant="secondary" onClick={disable}>Turn off</Button></>}
    {state === 'off' && <><p className="text-muted">Add an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) for stronger sign-in.</p><Button onClick={start}>Set up two-step verification</Button></>}
    {state === 'enrolling' && <div className="space-y-3"><p>Scan this QR code with your authenticator app, then enter the 6-digit code.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={qr} alt="QR code" className="h-40 w-40 rounded border border-border bg-white p-1" />
      <p className="text-xs text-muted">Can’t scan? Enter this key manually: <code className="select-all break-all">{secret}</code></p>
      <Field label="6-digit code"><Input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={7} /></Field><Button onClick={verify}>Verify &amp; turn on</Button></div>}
    {err && <Alert tone="red">{err}</Alert>}</div>
}
