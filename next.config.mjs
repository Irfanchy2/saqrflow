const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:" + (supabase ? ` ${supabase}` : ''),
  `connect-src 'self' ${supabase} ${supabase.replace('https://', 'wss://')}`.trim(),
  "frame-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ')

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // local OCR runs in a worker thread and loads its language data from disk — keep it unbundled and ship the data files
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core'],
  outputFileTracingIncludes: {
    '/**': ['./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**', './node_modules/tesseract.js-core/*-lstm.wasm'],
  },
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  async headers() {
    const common = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },            // same-origin only: the document preview iframe is ours
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ]
    return [
      // The file route sets its own (stricter) CSP; a global object-src 'none' would stop the browser PDF viewer.
      { source: '/api/documents/:path*', headers: common },
      { source: '/api/inbox/:path*', headers: common },
      { source: '/((?!api/documents|api/inbox).*)', headers: [{ key: 'Content-Security-Policy', value: csp }, ...common] },
    ]
  },
}
