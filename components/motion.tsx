'use client'
import { LazyMotion, MotionConfig, domMax } from 'framer-motion'
import type { ReactNode } from 'react'

/** Motion vocabulary for the whole app: short, decelerating, never bouncy. */
export const EASE = [0.2, 0, 0, 1] as const
export const T = { fast: { duration: 0.14, ease: EASE }, base: { duration: 0.2, ease: EASE }, slow: { duration: 0.28, ease: EASE } }

/**
 * One motion root (LazyMotion + `m.*` components) with layout animations, so highlights can glide between items (sidebar, tab bar);
 * and every animation respects the operating system's "reduce motion" setting.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <LazyMotion features={domMax} strict><MotionConfig reducedMotion="user" transition={T.base}>{children}</MotionConfig></LazyMotion>
}
