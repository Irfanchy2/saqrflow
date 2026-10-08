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
        success: v('success'), warning: v('warning'), danger: v('danger'),
      },
      // one radius system: sm = badges/chips, md = controls, lg = containers. xl/2xl are mapped onto lg so stray usages stay consistent.
      borderRadius: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.5rem', '2xl': '0.625rem' },
      // elevation is reserved for floating layers (menus, dialogs, toasts); surfaces use a border
      boxShadow: { card: 'none', pop: '0 8px 24px -6px hsl(222 30% 10% / .16), 0 2px 6px hsl(222 30% 10% / .06)', sm: '0 1px 2px hsl(222 30% 10% / .05)', md: '0 4px 12px -4px hsl(222 30% 10% / .12)', lg: '0 8px 24px -6px hsl(222 30% 10% / .16)' },
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
