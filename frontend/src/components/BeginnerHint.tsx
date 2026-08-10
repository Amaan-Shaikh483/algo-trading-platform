import type { ReactNode } from 'react'
import { Alert } from './ui'
import { useAuthStore } from '../store/authStore'

/**
 * §3.1 "trading experience level — used to show/hide advanced features":
 * renders extra guidance only for beginners (set on the Profile page).
 */
export default function BeginnerHint({ title, children }: { title?: string; children: ReactNode }) {
  const level = useAuthStore((s) => s.profile?.experience_level)
  if (level !== 'beginner') return null
  return <Alert tone="blue" title={title}>{children}</Alert>
}
