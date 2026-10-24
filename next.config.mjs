// Content-Security-Policy is set per request in middleware.ts (it carries a fresh script nonce).

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // Local OCR loads its models from disk (PaddleOCR through the ONNX Runtime native add-on; Tesseract in a worker thread as
  // the fallback) — keep these unbundled and ship the model files.
  serverExternalPackages: ['tesseract.js', 'tesseract.js-core', 'onnxruntime-node', 'paddleocr'],
  // Only the routes that can run OCR (Smart Inbox, its processing API, receipt scan, the AI settings test and the assistant)
  // ship the OCR models (~37 MB PaddleOCR + ~20 MB Tesseract: every wasm build, it picks one by CPU at run time) and the Linux ONNX Runtime. Every other page's server function
  // stays small, so it starts faster.
  outputFileTracingIncludes: Object.fromEntries(['/inbox', '/inbox/[id]', '/settings', '/assistant', '/api/inbox/[id]/process', '/api/expenses/scan']
    .map(r => [r, ['./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**', './node_modules/tesseract.js-core/*.wasm',
      './ocr-models/ppocrv6-small/*.onnx', './ocr-models/ppocrv6-small/dict.txt', './ocr-models/ppocrv6-tiny/*',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node', './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1',
      './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_shared.so']])),
  // ONNX Runtime ships add-ons for every platform and GPU: the server only needs the Linux x64 CPU one.
  outputFileTracingExcludes: { '*': ['./node_modules/onnxruntime-node/bin/napi-v6/darwin/**', './node_modules/onnxruntime-node/bin/napi-v6/win32/**',
    './node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**', './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so',
    './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt.so'] },
  // Pages already opened stay in the browser for a few minutes, so going back to one is instant (no new server render).
  // Saving anything (server actions call revalidatePath) clears this cache, so what you changed always shows.
  experimental: { serverActions: { bodySizeLimit: '16mb' }, staleTimes: { dynamic: 180, static: 300 } },
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
