import type { Extraction } from '../../inbox/rules'
import type { Match } from '../../inbox/match'

export type AiProviderId = 'gemini' | 'claude'
export type AiMode = 'auto' | 'gemini' | 'claude' | 'rules'
export interface ClassifyInput { text: string; file?: { bytes: Uint8Array; mime: string } | null }
export interface ClassifyOutput { extraction: Extraction; warnings: string[]; requiresReview: boolean; ms: number; model: string }
export class AiError extends Error {
  constructor(message: string, public code: 'not_configured' | 'auth' | 'rate_limited' | 'timeout' | 'blocked' | 'invalid_output' | 'provider', public provider: AiProviderId) { super(message); this.name = 'AiError' }
}

/** Swappable LLM layer. Entity matching stays local (employee lists are never sent to a third party). */
export interface AIProvider {
  id: AiProviderId
  label: string
  model: string
  configured(): boolean
  /** classification + metadata extraction in one structured call, validated against the OCR text */
  classifyDocument(input: ClassifyInput): Promise<ClassifyOutput>
  extractMetadata(input: ClassifyInput): Promise<ClassifyOutput>
  matchEntity(name: string, candidates: { id: string; name: string }[]): Match[]
  /** generic strict-JSON call (used by AI search) */
  generateStructuredOutput<T>(system: string, user: string, responseSchema: object, validate: (raw: unknown) => T): Promise<T>
  healthCheck(): Promise<{ ok: boolean; message: string; ms: number }>
}
