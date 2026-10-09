// Offline drafts: unsaved work kept in this browser (localStorage) until it is saved to the server. Never secrets or files.
// All keys start with "avq-draft:" and are wiped on sign-out, so the next person on a shared device does not see them.
export const DRAFT_PREFIX = 'avq-draft:'
export const DRAFT_MAX_AGE = 14 * 864e5

export function readDraft<T>(key: string): { at: number; data: T } | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key); if (!raw) return null
    const v = JSON.parse(raw)
    if (!v || typeof v.at !== 'number' || Date.now() - v.at > DRAFT_MAX_AGE) { localStorage.removeItem(DRAFT_PREFIX + key); return null }
    return v
  } catch { return null }
}
export function writeDraft(key: string, data: unknown) {
  try { localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ at: Date.now(), data })) } catch { /* storage full or blocked: the form still works */ }
}
export function clearDraft(key: string) { try { localStorage.removeItem(DRAFT_PREFIX + key) } catch { /* ignore */ } }
export function clearAllDrafts() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(DRAFT_PREFIX)) localStorage.removeItem(k) } } catch { /* ignore */ }
}
export const draftAge = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} day(s) ago` }
