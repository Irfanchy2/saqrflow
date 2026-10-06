import 'server-only'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

// Minimal, dependency-free .xlsx writer and reader (first worksheet, text + numbers). Enough for list exports and imports.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&')
const col = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0
  for (const f of files) {
    const name = Buffer.from(f.name), comp = deflateRawSync(f.data), crc = crc32(f.data)
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26)
    parts.push(h, name, comp)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42)
    central.push(c, name); off += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return new Uint8Array(Buffer.concat([...parts, cd, end]))
}

/** Workbook with one sheet; header row bold; numbers stay numeric; text cells are inline strings (no formulas are ever written). */
export function writeXlsx(sheet: string, headers: string[], rows: unknown[][]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s)
  const cell = (v: unknown, r: number, c: number, bold = false) => {
    const ref = `${col(c)}${r}`
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
    if (v === null || v === undefined || v === '') return ''
    return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
  }
  const xmlRows = [headers, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, i + 1, j, i === 0)).join('')}</row>`).join('')
  const widths = headers.map((h, j) => Math.min(60, Math.max(h.length, ...rows.slice(0, 200).map(r => String(r[j] ?? '').length)) + 2))
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${xmlRows}</sheetData></worksheet>`
  return zip([
    { name: '[Content_Types].xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'xl/styles.xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>') },
    { name: 'xl/worksheets/sheet1.xml', data: enc(sheetXml) },
  ])
}

function unzip(buf: Uint8Array): Map<string, Buffer> {
  const b = Buffer.from(buf), out = new Map<string, Buffer>()
  let eocd = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a valid .xlsx file')
  const n = b.readUInt16LE(eocd + 10); let p = b.readUInt32LE(eocd + 16)
  for (let k = 0; k < n; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt .xlsx file')
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42)
    const name = b.subarray(p + 46, p + 46 + nl).toString()
    const ds = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.subarray(ds, ds + csize)
    if (/^(xl\/sharedStrings\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml)$/.test(name)) {
      const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 }) : null
      if (data) out.set(name, data)
    }
    p += 46 + nl + el + cl
  }
  return out
}

/** Rows of the first worksheet as strings (dates stay as Excel serials unless typed as text). Max 5,000 rows. */
export function readXlsx(buf: Uint8Array): string[][] {
  const f = unzip(buf)
  const shared = [...(f.get('xl/sharedStrings.xml')?.toString() ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')))
  const wb = f.get('xl/workbook.xml')?.toString() ?? '', rels = f.get('xl/_rels/workbook.xml.rels')?.toString() ?? ''
  const rid = wb.match(/<sheet [^>]*r:id="([^"]+)"/)?.[1]
  const target = rid ? rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const xml = (f.get(path) ?? f.get('xl/worksheets/sheet1.xml'))?.toString()
  if (!xml) throw new Error('The workbook has no worksheet')
  const rows: string[][] = []
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/r="([A-Z]+)\d+"/)?.[1] ?? '', type = c[1].match(/t="([^"]+)"/)?.[1]
      const idx = [...ref].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1], is = c[2]?.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
      row[Math.max(0, idx)] = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? unesc(is ?? '') : unesc(v ?? '')
    }
    rows.push(Array.from(row, x => (x ?? '').trim()))
    if (rows.length > 5000) break
  }
  return rows.filter(r => r.some(Boolean))
}
