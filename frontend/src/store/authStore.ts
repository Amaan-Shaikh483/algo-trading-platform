import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { appMeta } from '../lib/appMeta'

interface Profile {
  full_name: string | null
  experience_level: string
  role: string
  onboarding_completed: boolean
}

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  initialized: boolean
  /** Set when the user arrived via a password-recovery link — forces the reset screen. */
  passwordRecovery: boolean
  init: () => Promise<void>
  refreshProfile: () => Promise<void>
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}

/**
 * Global auth state (Section 3.1). The Supabase JWT held here is attached to
 * every backend request; the backend verifies it in middleware/auth.ts.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  initialized: false,
  passwordRecovery: false,

  init: async () => {
    const { data } = await supabase.auth.getSession()
    set({ session: data.session, user: data.session?.user ?? null, initialized: true })
    await get().refreshProfile()

    supabase.auth.onAuthStateChange(async (event, session) => {
      // Never let appMeta's cached reads bleed across accounts in the same tab.
      if (event === 'SIGNED_OUT' || (session?.user?.id ?? null) !== get().user?.id) appMeta.invalidateAll()
      set({ session, user: session?.user ?? null })
      if (event === 'PASSWORD_RECOVERY') set({ passwordRecovery: true })
      await get().refreshProfile()
    })
  },

  clearPasswordRecovery: () => set({ passwordRecovery: false }),

  refreshProfile: async () => {
    const userId = get().user?.id
    if (!userId) {
      set({ profile: null })
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('full_name, experience_level, role, onboarding_completed')
      .eq('id', userId)
      .maybeSingle()
    set({ profile: data ?? null })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null, profile: null })
  },
}))
