import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...i: ClassValue[]) => twMerge(clsx(i))
export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string | undefined>; data?: Record<string, any> } | null
