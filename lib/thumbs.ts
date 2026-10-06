import 'server-only'
import { createAdminClient } from './supabase/admin'

const WIDTHS = [96, 320, 640] as const
/**
 * Small WebP preview of a private image, cached next to the original (`<path>.w320.webp`), served by a 60-second signed URL.
 * The original file is never modified. Falls back to the original when the image cannot be decoded (e.g. HEIC without codec).
 * Call only AFTER the caller's RLS check passed for the record that owns `path`.
 */
export async function thumbUrl(path: string, width: number): Promise<string | null> {
  const w = WIDTHS.find(x => x >= width) ?? 640
  const admin = createAdminClient(), bucket = admin.storage.from('vault'), tpath = `${path}.w${w}.webp`
  const cached = await bucket.createSignedUrl(tpath, 60)
  if (cached.data?.signedUrl) {
    // createSignedUrl succeeds even for missing objects on some versions — confirm it exists
    const head = await fetch(cached.data.signedUrl, { method: 'HEAD' }).catch(() => null)
    if (head?.ok) return cached.data.signedUrl
  }
  const { data: orig } = await bucket.download(path)
  if (!orig) return null
  try {
    const sharp = (await import('sharp')).default
    const out = await sharp(Buffer.from(await orig.arrayBuffer()), { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer()
    await bucket.upload(tpath, out, { contentType: 'image/webp', upsert: true })
    return (await bucket.createSignedUrl(tpath, 60)).data?.signedUrl ?? null
  } catch {
    return (await bucket.createSignedUrl(path, 60)).data?.signedUrl ?? null
  }
}
