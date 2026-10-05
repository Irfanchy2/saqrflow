import type { Config } from 'tailwindcss'
const v = (n: string) => `hsl(var(--${n}) / <alpha-value>)`
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'), fg: v('fg'), muted: v('muted'),
        primary: v('primary'), 'primary-fg': v('primary-fg'), 'primary-soft': v('primary-soft'),
        success: v('success'), warning: v('warning'), danger: v('danger'),
      },
      borderRadius: { lg: '0.75rem', md: '0.5rem' },
      boxShadow: { card: '0 1px 2px hsl(220 20% 10% / .04), 0 1px 3px hsl(220 20% 10% / .06)' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans Arabic', 'Noto Sans Bengali', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config
