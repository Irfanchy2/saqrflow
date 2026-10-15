import type { Config } from 'tailwindcss'
const v = (n: string) => `hsl(var(--${n}) / <alpha-value>)`
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'), 'border-strong': v('border-strong'), fg: v('fg'), muted: v('muted'),
        primary: v('primary'), 'primary-fg': v('primary-fg'), 'primary-soft': v('primary-soft'), nav: v('nav'),
        sb: v('sb'), 'sb-2': v('sb-2'), 'sb-line': v('sb-line'), 'sb-fg': v('sb-fg'), 'sb-muted': v('sb-muted'), 'sb-accent': v('sb-accent'),
        success: v('success'), warning: v('warning'), danger: v('danger'),
      },
      // one radius system: sm = badges/chips, md = controls, lg = containers. xl/2xl are mapped onto lg so stray usages stay consistent.
      borderRadius: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.5rem', '2xl': '0.625rem' },
      // elevation is reserved for floating layers (menus, dialogs, toasts); surfaces use a border
      boxShadow: { card: '0 1px 2px hsl(var(--shadow) / .04)', pop: '0 12px 32px -8px hsl(var(--shadow) / .22), 0 2px 6px hsl(var(--shadow) / .08)', sm: '0 1px 2px hsl(var(--shadow) / .06)', md: '0 4px 12px -4px hsl(var(--shadow) / .14)', lg: '0 12px 32px -8px hsl(var(--shadow) / .22)', btn: 'inset 0 1px 0 hsl(0 0% 100% / .14), 0 1px 2px hsl(var(--shadow) / .18)' },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Noto Sans Arabic', 'Noto Sans Bengali', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { '2xs': ['11px', '16px'] },
      transitionDuration: { DEFAULT: '150ms' },
      zIndex: { nav: '30', drawer: '50', pop: '60', toast: '70' },
    },
  },
  plugins: [],
} satisfies Config
