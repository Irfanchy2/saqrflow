import type { MetadataRoute } from 'next'

// Installable app (Add to Home Screen). Averiqo is the software brand; company identity stays on documents only.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Averiqo Business OS', short_name: 'Averiqo', description: 'Quotations, invoices, projects, documents, employees, vehicles and renewals for UAE businesses.',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#000e4a', theme_color: '#000e4a',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
