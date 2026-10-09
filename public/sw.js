// Averiqo service worker: makes the installed app open and fail gracefully without a connection.
// Only static build assets and the offline page are cached. Pages and data always come from the network (nothing
// confidential is stored by the worker); unsaved work is kept separately as drafts on the device (lib/drafts.ts).
const VERSION = 'avq-v1'
const STATIC = `${VERSION}-static`
const OFFLINE = '/offline'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll([OFFLINE, '/brand/icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
const isStatic = url => url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/') || /\.(woff2?|ico)$/.test(url.pathname)

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isStatic(url)) {   // content-hashed build files: cache first
    e.respondWith(caches.open(STATIC).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r })))
    return
  }
  if (req.mode === 'navigate') {   // pages: always the network; the offline page only when there is no connection
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then(r => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }))))
  }
})
