import { describe, it, expect, afterAll } from 'vitest'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error plain .mjs build script
import { dictFromModel, fetchTinyModels, MANIFEST } from '../../scripts/fetch-ocr-models.mjs'

// The build step that installs the PP-OCRv6 tiny models: only files whose SHA-256 matches RapidAI's published value are
// kept, nothing half-installed, and the build carries on (small models) when anything is wrong.
const SMALL = 'ocr-models/ppocrv6-small'
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const files: Record<string, Buffer> = { '/det.onnx': fs.readFileSync(`${SMALL}/det.onnx`), '/rec.onnx': fs.readFileSync(`${SMALL}/rec.onnx`) }
const server = http.createServer((req, res) => { const b = files[req.url ?? '']; if (!b) { res.writeHead(404); res.end(); return } res.writeHead(200); res.end(b) })
const base = await new Promise<string>(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))
afterAll(() => server.close())
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-models-'))
const quiet = () => {}

describe('tiny OCR models download (build step)', () => {
  it('pins RapidAI’s published hashes for the official files', () => {
    expect(MANIFEST['det.onnx'].sha256).toBe('f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5')
    expect(MANIFEST['rec.onnx'].sha256).toBe('e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b')
    expect(MANIFEST['rec.onnx'].url).toMatch(/^https:\/\/www\.modelscope\.cn\/models\/RapidAI\/RapidOCR\/resolve\/v3\.10\.0\//)
  })
  it('reads the character list stored inside a RapidOCR model', () => {
    const dict = dictFromModel(files['/rec.onnx'], 18708)
    expect(dict).toEqual(fs.readFileSync(`${SMALL}/dict.txt`, 'utf8').trimEnd().split('\n'))
    expect(dictFromModel(files['/rec.onnx'])).toBeNull()                 // wrong length for the tiny model → refused
  })
  it('installs the files when every hash matches', async () => {
    const dir = tmp()
    const ok = await fetchTinyModels({ dir, dictLength: 18708, log: quiet, manifest: {
      'det.onnx': { url: `${base}/det.onnx`, sha256: sha(files['/det.onnx']) }, 'rec.onnx': { url: `${base}/rec.onnx`, sha256: sha(files['/rec.onnx']) } } })
    expect(ok).toBe(true)
    expect(fs.readdirSync(dir).sort()).toEqual(['det.onnx', 'dict.txt', 'rec.onnx'])
  })
  it('installs nothing when a file does not match its published hash', async () => {
    const dir = tmp()
    const ok = await fetchTinyModels({ dir, dictLength: 18708, log: quiet, manifest: {
      'det.onnx': { url: `${base}/det.onnx`, sha256: sha(files['/det.onnx']) }, 'rec.onnx': { url: `${base}/rec.onnx`, sha256: '0'.repeat(64) } } })
    expect(ok).toBe(false); expect(fs.readdirSync(dir)).toEqual([])
  })
  it('installs nothing (and does not throw) when the download fails', async () => {
    const dir = tmp()
    expect(await fetchTinyModels({ dir, log: quiet, manifest: { 'det.onnx': { url: `${base}/missing.onnx`, sha256: 'x' } } })).toBe(false)
    expect(fs.readdirSync(dir)).toEqual([])
  })
})
