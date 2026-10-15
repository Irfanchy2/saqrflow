import type { Config } from 'tailwindcss'
const v = (n: string) => `hsl(var(--${n}) / <alpha-value>)`
export default {
  darkMode: ['class'],
  // hover styles only on devices that can hover, so a tapped row or button doesn't stay highlighted on phones
  future: { hoverOnlyWhenSupported: true },
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'), 'border-strong': v('border-strong'), fg: v('fg'), muted: v('muted'),
        primary: v('primary'), 'primary-fg': v('primary-fg'), 'primary-soft': v('primary-soft'), nav: v('nav'), ink: v('ink'), 'ink-fg': v('ink-fg'),
        sb: v('sb'), 'sb-2': v('sb-2'), 'sb-line': v('sb-line'), 'sb-fg': v('sb-fg'), 'sb-muted': v('sb-muted'), 'sb-accent': v('sb-accent'),
        success: v('success'), warning: v('warning'), danger: v('danger'),
      },
      // radius: sm = badges/chips 6px · md = small controls 8px · lg = buttons, inputs, tiles 10px · xl = cards 14px · 2xl = sheets 18px
      borderRadius: { sm: '0.375rem', md: '0.5rem', lg: '0.625rem', xl: '0.875rem', '2xl': '1.125rem' },
      // one light source from above: every layer is a hairline plus a short contact shadow and a long soft one, tinted navy.
      // card = resting surface · lift = hovered card · pop = menus, dialogs, toasts · key = secondary button · solid = filled button
      boxShadow: {
        card: 'inset 0 1px 0 hsl(var(--hi)), 0 1px 1px hsl(var(--shadow) / .03), 0 2px 4px -1px hsl(var(--shadow) / .04), 0 8px 18px -10px hsl(var(--shadow) / .08)',
        lift: 'inset 0 1px 0 hsl(var(--hi)), 0 1px 2px hsl(var(--shadow) / .05), 0 6px 12px -4px hsl(var(--shadow) / .08), 0 18px 32px -16px hsl(var(--shadow) / .18)',
        pop: '0 0 0 1px hsl(var(--shadow) / .04), 0 4px 8px -2px hsl(var(--shadow) / .08), 0 18px 40px -12px hsl(var(--shadow) / .28)',
        sm: '0 1px 2px hsl(var(--shadow) / .06)', md: '0 4px 12px -4px hsl(var(--shadow) / .14)', lg: '0 12px 32px -8px hsl(var(--shadow) / .22)',
        key: 'inset 0 1px 0 hsl(var(--hi)), inset 0 -1px 0 hsl(var(--shadow) / .06), 0 1px 2px hsl(var(--shadow) / .06)',
        solid: 'inset 0 1px 0 hsl(0 0% 100% / .16), 0 0 0 1px hsl(var(--b)), 0 1px 2px hsl(var(--shadow) / .2), 0 4px 10px -4px hsl(var(--b) / .5)',
        'solid-hover': 'inset 0 1px 0 hsl(0 0% 100% / .2), 0 0 0 1px hsl(var(--b)), 0 2px 4px hsl(var(--shadow) / .2), 0 8px 18px -6px hsl(var(--b) / .55)',
        field: 'inset 0 1px 2px hsl(var(--shadow) / .04)',
        focus: '0 0 0 3.5px hsl(var(--primary) / .16)',
        btn: 'inset 0 1px 0 hsl(0 0% 100% / .14), 0 1px 2px hsl(var(--shadow) / .18)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Noto Sans Arabic', 'Noto Sans Bengali', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: { '2xs': ['11px', '16px'] },
      transitionDuration: { DEFAULT: '160ms' },
      // decelerating: things arrive quickly and settle; never linear, never bouncy
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(.2,.8,.2,1)', out: 'cubic-bezier(.2,.8,.2,1)', spring: 'cubic-bezier(.32,.72,0,1)' },
      zIndex: { nav: '30', drawer: '50', pop: '60', toast: '70' },
    },
  },
  plugins: [],
} satisfies Config
