import { supabase } from './supabaseClient'
import { apiGet, apiPost, apiRequest } from './api'

/**
 * Spec §3.9 notifications. The INBOX reads/writes the `notifications` table
 * directly through Supabase (RLS scopes rows to the owner; the table is in
 * the realtime publication). PREFERENCES round-trip the backend API
 * (/api/notifications) because upserts happen server-side and the backend
 * keeps a 30s prefs cache that needs invalidating on save.
 */

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  channel: 'in_app' | 'email' | 'telegram'
  read: boolean
  created_at: string
}

export interface ChannelPrefs {
  in_app: boolean
  email: boolean
  telegram: boolean
}

export interface NotificationEventInfo {
  type: string
  label: string
  description: string
  critical?: boolean
}

export interface PreferencesView {
  events: NotificationEventInfo[]
  prefs: { telegram_chat_id: string | null; events: Record<string, ChannelPrefs> }
  channels: { telegramConfigured: boolean; emailConfigured: boolean }
}

const apiPut = <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, body ?? {})

export const notificationApi = {
  /* ── Inbox (direct Supabase, RLS-protected) ── */
  async list(limit = 100): Promise<NotificationRow[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as NotificationRow[]
  },

  async unreadCount(): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('read', false)
    if (error) throw new Error(error.message)
    return count ?? 0
  },

  async markRead(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids)
    if (error) throw new Error(error.message)
  },

  async markAllRead(): Promise<void> {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('read', false)
    if (error) throw new Error(error.message)
  },

  /* ── Preferences (backend API) ── */
  getPrefs: () => apiGet<PreferencesView>('/api/notifications/preferences'),
  savePrefs: (input: { telegram_chat_id: string | null; events: Record<string, ChannelPrefs> }) =>
    apiPut<PreferencesView>('/api/notifications/preferences', input),
  testChannel: (channel: 'email' | 'telegram') =>
    apiPost<{ sent: boolean; reason?: string }>('/api/notifications/test', { channel }),
}
