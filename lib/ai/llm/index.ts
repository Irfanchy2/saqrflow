import 'server-only'
import { getSecret } from '../secrets'
import { geminiProvider } from './gemini'
import { claudeProvider } from './claude'
import type { AIProvider, AiMode } from './types'

export * from './types'
export const AI_MODES: { id: AiMode; label: string }[] = [
  { id: 'auto', label: 'Auto (Gemini → Claude → local rules)' }, { id: 'gemini', label: 'Google Gemini' },
  { id: 'claude', label: 'Anthropic Claude (reads the file itself)' }, { id: 'rules', label: 'Local rules only (no AI service)' },
]
export const isAiMode = (v: unknown): v is AiMode => AI_MODES.some(m => m.id === v)

export async function aiProviders(companyId: string | null): Promise<{ gemini: AIProvider; claude: AIProvider }> {
  return {
    gemini: geminiProvider({ apiKey: await getSecret(companyId, 'gemini_api_key'), model: process.env.GEMINI_MODEL, endpoint: process.env.GEMINI_ENDPOINT }),
    claude: claudeProvider(),
  }
}
/** The provider to use for this upload, or null for local rules only. */
export function pickAi(mode: AiMode, p: { gemini: AIProvider; claude: AIProvider }, hasText: boolean): AIProvider | null {
  if (mode === 'rules') return null
  if (mode === 'gemini') return p.gemini.configured() ? p.gemini : null
  if (mode === 'claude') return p.claude.configured() ? p.claude : null
  if (p.gemini.configured() && hasText) return p.gemini        // Gemini works on OCR text only (data minimisation)
  if (p.claude.configured()) return p.claude
  return null
}
