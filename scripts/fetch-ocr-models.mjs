// Downloads the PaddleOCR PP-OCRv6 *tiny* models (the fast first reader for receipts) at build time, from RapidAI's
// official RapidOCR model store, and keeps them only when their SHA-256 matches RapidAI's published value
// (rapidocr 3.10.0, default_models.yaml). Anything wrong (no network, wrong hash, unexpected file) → the tiny models are
// simply not installed and the app reads with the PP-OCRv6 small models that are in the repository. Never fails the build.
//
//   node scripts/fetch-ocr-models.mjs        (runs before `next build`; skipped when the files are already there)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6'
export const MANIFEST = {
  'det.onnx': { url: `${BASE}/det/PP-OCRv6_det_tiny.onnx`, sha256: 'f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5' },
  'rec.onnx': { url: `${BASE}/rec/PP-OCRv6_rec_tiny.onnx`, sha256: 'e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b' },
}
export const TINY_DICT_LENGTH = 6904          // PP-OCRv6 tiny: 6,906 output classes = CTC blank + 6,904 characters + space

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')

/** The character list RapidOCR stores in the recognition model's metadata (key "character", one per line). */
export function dictFromModel(buf, expected = TINY_DICT_LENGTH) {
  const key = Buffer.from('\n\tcharacter\x12'), at = buf.indexOf(key)
  if (at < 0) return null
  let i = at + key.length, len = 0, shift = 0
  for (;;) { const c = buf[i++]; len |= (c & 0x7f) << shift; shift += 7; if (c < 0x80 || shift > 28) break }
  const chars = buf.subarray(i, i + len).toString('utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n')
  return chars.length === expected ? chars : null
}

async function download(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Installs the tiny models into `dir`. Returns true when they are there and verified. Writes nothing unless every file
 * checks out (so a half-installed set can never be used).
 */
export async function fetchTinyModels({ dir, manifest = MANIFEST, dictLength = TINY_DICT_LENGTH, timeoutMs = 90_000, log = console.log } = {}) {
  const have = Object.entries(manifest).every(([f, m]) => fs.existsSync(path.join(dir, f)) && sha(fs.readFileSync(path.join(dir, f))) === m.sha256) && fs.existsSync(path.join(dir, 'dict.txt'))
  if (have) { log('[ocr-models] PP-OCRv6 tiny already installed and verified'); return true }
  try {
    const files = {}
    for (const [f, m] of Object.entries(manifest)) {
      const buf = await download(m.url, timeoutMs)
      const got = sha(buf)
      if (got !== m.sha256) throw new Error(`${f}: SHA-256 ${got} does not match the published ${m.sha256}`)
      files[f] = buf
    }
    const dict = dictFromModel(files['rec.onnx'], dictLength)
    if (!dict) throw new Error('rec.onnx: no character list of the expected length in the model')
    fs.mkdirSync(dir, { recursive: true })
    for (const [f, buf] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), buf)
    fs.writeFileSync(path.join(dir, 'dict.txt'), dict.join('\n') + '\n')
    log(`[ocr-models] PP-OCRv6 tiny installed and verified (${Object.values(files).reduce((s, b) => s + b.length, 0)} bytes)`)
    return true
  } catch (e) {
    log(`[ocr-models] PP-OCRv6 tiny not installed (${e.message}). Receipts are read with the PP-OCRv6 small models instead.`)
    return false
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.env.SAQRFLOW_SKIP_TINY_OCR === '1') console.log('[ocr-models] skipped (SAQRFLOW_SKIP_TINY_OCR=1)')
  else await fetchTinyModels({ dir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ocr-models', 'ppocrv6-tiny') })
}
