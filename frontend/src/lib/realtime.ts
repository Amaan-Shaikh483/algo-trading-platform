import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useAuthStore } from '../store/authStore'

/**
 * Supabase Realtime helper (spec §3.8: "pushed in real time via Realtime
 * channels — no polling"): subscribes the current user to postgres_changes on
 * the given engine tables and invokes `onEvent` (debounced) on any insert /
 * update / delete. Tables are published + RLS-scoped since migration 00001, so
 * each user only receives their own rows.
 */
/* Multiple widgets subscribe concurrently (bell + page + dashboard) — channel
 * topics must be unique per subscription or the client/server can collide. */
let channelSeq = 0

export function useRealtimeTables(tables: string[], onEvent: (table: string) => void) {
  const userId = useAuthStore((s) => s.user?.id)
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    if (!userId || tables.length === 0) return
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase.channel(`rt-${userId}-${++channelSeq}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', filter: `user_id=eq.${userId}` },
      (payload) => {
        const table = (payload as { table?: string }).table ?? ''
        if (!tables.includes(table)) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => handlerRef.current(table), 300)
      },
    )
    channel.subscribe()
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      void supabase.removeChannel(channel)
    }
    // tables list is static per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
}
