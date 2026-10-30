// The Projects icon, drawn for Averiqo: a project document (title, plan block, a line of text) rolled into a scroll at the
// foot, with a gear for the work in progress. Same props as the Phosphor set (size, weight, color), so it drops in next to
// those icons; "fill" adds a tinted page, "bold" a heavier line. No hooks: works in server and client components.
import { forwardRef } from 'react'
import type { Icon, IconProps } from '@phosphor-icons/react'

/** Shared drawing (24 px grid), also used by the phone tab bar. */
export const PROJECT_PAGE = 'M4 17.5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11.5H8a2 2 0 0 0-2 2a2 2 0 0 1-2-1Z'
export const PROJECT_LINES = <>
  <path d="M17.8 6.6V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v13" />
  <path d="M4 18a2.5 2.5 0 0 0 2.5 2.5H19a2 2 0 0 0 0-4H8.5A2 2 0 0 0 6.5 18.5" />
  <path d="M7 6.3h5.8" strokeWidth="2.4" />
  <rect x="7" y="9" width="3.4" height="2.8" rx=".7" />
  <path d="M7 14.3h3.2" />
  <path d="M15.74 9.21 L15.94 8.07 L17.46 8.07 L17.66 9.21 L18.64 9.77 L19.72 9.38 L20.48 10.70 L19.60 11.44 L19.60 12.56 L20.48 13.30 L19.72 14.62 L18.64 14.23 L17.66 14.79 L17.46 15.93 L15.94 15.93 L15.74 14.79 L14.76 14.23 L13.68 14.62 L12.92 13.30 L13.80 12.56 L13.80 11.44 L12.92 10.70 L13.68 9.38 L14.76 9.77Z" />
  <circle cx="16.7" cy="12" r="1.15" />
</>

export const ProjectIcon = forwardRef<SVGSVGElement, IconProps>(function ProjectIcon({ size = '1em', weight = 'regular', color = 'currentColor', mirrored, children, style, ...rest }, ref) {
  return <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={weight === 'bold' ? 2.1 : weight === 'light' || weight === 'thin' ? 1.3 : 1.7}
    strokeLinecap="round" strokeLinejoin="round" style={mirrored ? { transform: 'scale(-1, 1)', ...style } : style} {...rest}>
    {children}
    {(weight === 'fill' || weight === 'duotone') && <path d={PROJECT_PAGE} fill={color} stroke="none" opacity={weight === 'fill' ? 0.3 : 0.2} />}
    {PROJECT_LINES}
  </svg>
}) as Icon
