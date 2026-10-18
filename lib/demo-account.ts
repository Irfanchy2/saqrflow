/** The shared demo sign-in shown on the login page. Public on purpose: it only opens the isolated demo company. */
export const DEMO_EMAIL = 'demo@admin.com'
export const DEMO_PASSWORD = 'admin123'
export const isDemoEmail = (e?: string | null) => (e ?? '').trim().toLowerCase() === DEMO_EMAIL

/** Thrown by server actions that the shared demo may not use; `safe` shows the message as is. */
export class DemoBlockedError extends Error {
  constructor(what: string) { super(`Not available in the shared demo: ${what}. Create your own account to use it.`); this.name = 'DemoBlockedError' }
}
