// Minimal types for the parts of fontkit (https://github.com/foliojs/fontkit) used by lib/sales/paid-stamp.ts.
declare module 'fontkit' {
  export interface FkPath {
    toSVG(): string
    transform(m0: number, m1: number, m2: number, m3: number, m4: number, m5: number): FkPath
  }
  export interface FkGlyph { id: number; path: FkPath; advanceWidth: number }
  export interface FkPosition { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }
  export interface FkRun { glyphs: FkGlyph[]; positions: FkPosition[]; direction?: 'ltr' | 'rtl'; advanceWidth: number }
  export interface FkFont { unitsPerEm: number; ascent: number; descent: number; capHeight?: number; layout(text: string, features?: string[] | Record<string, boolean>): FkRun }
  export function create(buffer: Buffer | Uint8Array): FkFont
  export function openSync(path: string): FkFont
}
