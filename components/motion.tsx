'use client'
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion'
import type { ReactNode } from 'react'

/** Motion vocabulary for the whole app: short, decelerating, never bouncy. */
export const EASE = [0.2, 0, 0, 1] as const
export const T = { fast: { duration: 0.14, ease: EASE }, base: { duration: 0.2, ease: EASE }, slow: { duration: 0.28, ease: EASE } }

/**
 * One motion root: only the small DOM-animation feature set is loaded (LazyMotion + `m.*` components),
 * and every animation respects the operating system's "reduce motion" setting.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user" transition={T.base}>{children}</MotionConfig></LazyMotion>
}
