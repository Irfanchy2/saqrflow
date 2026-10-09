import 'server-only'
import QRCode from 'qrcode'
export { baseUrl } from '@/lib/portal'

/** Inline SVG QR code (error correction M: survives scratches and dirt on a vehicle label). */
export const qrSvg = (text: string) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 240 })
