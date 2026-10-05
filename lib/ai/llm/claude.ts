import 'server-only'
import { claudeAvailable, claudeExtract, CLAUDE_MODEL } from '../../inbox/claude'
import { matchByName } from '../../inbox/match'
import { typeDef } from '../../inbox/catalog'
import { AiError, type AIProvider } from './types'

/** Anthropic Claude: reads the original file itself (vision), so it can work even when OCR found no text. */
export function claudeProvider(): AIProvider {
  const p: AIProvider = {
    id: 'claude', label: 'Anthropic Claude', model: CLAUDE_MODEL,
    configured: claudeAvailable,
    async classifyDocument(input) {
      if (!claudeAvailable()) throw new AiError('ANTHROPIC_API_KEY is not configured', 'not_configured', 'claude')
      if (!input.file) throw new AiError('Claude needs the original file', 'invalid_output', 'claude')
      const t0 = Date.now()
      try {
        const x = await claudeExtract(input.file.bytes, input.file.mime, input.text)
        const def = typeDef(x.docType)
        return { extraction: x, warnings: [], requiresReview: x.docTypeConfidence < 0.7 || (!!def?.hasExpiry && !x.fields.expiry_date), ms: Date.now() - t0, model: x.engineVersion }
      } catch (e) { throw new AiError((e as Error).message, 'provider', 'claude') }
    },
    extractMetadata: input => p.classifyDocument(input),
    matchEntity: (name, candidates) => matchByName(name, candidates),
    async generateStructuredOutput() { throw new AiError('Structured search is implemented with Gemini only', 'not_configured', 'claude') },
    async healthCheck() { return { ok: claudeAvailable(), message: claudeAvailable() ? 'API key present' : 'ANTHROPIC_API_KEY is not set', ms: 0 } },
  }
  return p
}
