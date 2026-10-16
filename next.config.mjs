// Content-Security-Policy is set per request in middleware.ts (it carries a fresh script nonce).

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // local OCR runs in a worker thread and loads its language data from disk — keep it unbundled and ship the data files
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core'],
  // Only the routes that can run OCR (Smart Inbox, its processing API, receipt scan, the AI settings test and the assistant)
  // ship the ~11 MB of language data and wasm. Every other page's server function stays small, so it starts faster.
  outputFileTracingIncludes: Object.fromEntries(['/inbox', '/inbox/[id]', '/settings', '/assistant', '/api/inbox/[id]/process', '/api/expenses/scan']
    .map(r => [r, ['./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**', './node_modules/tesseract.js-core/*-lstm.wasm']])),
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  async headers() {
    const common = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },            // same-origin only: the document preview iframe is ours
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },   // other sites cannot script a window they open of this app
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
    ]
    return [
      // The file route sets its own (stricter) CSP; a global object-src 'none' would stop the browser PDF viewer.
      { source: '/api/documents/:path*', headers: common },
      { source: '/api/inbox/:path*', headers: common },
      // public enquiry forms (/f/<slug>) may be embedded in the company's own website; everything else stays same-origin only
      { source: '/f/:path*', headers: common.filter(h => h.key !== 'X-Frame-Options') },
      { source: '/((?!api/documents|api/inbox|f/).*)', headers: common },
    ]
  },
}
