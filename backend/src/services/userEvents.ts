import { getServiceClient } from '../supabase/client'
import { logger } from '../lib/logger'
import { DEFAULT_CHANNEL_PREFS, dispatchExternal, getEffectivePrefs } from './notificationDispatch'

/**
 * Shared user-facing event writers (spec §3.1 audit trail + §3.9 notifications).
 * Inserts are best-effort: event loss must never break trading safety flow.
 *
 * Notification `type` vocabulary (spec §3.9 trigger events — catalog lives in
 * notificationDispatch.NOTIFICATION_EVENTS):
 *   order_placed | order_filled | order_rejected | sl_hit | target_hit |
 *   daily_loss_limit | strategy_error | token_expired | kill_switch |
 *   backtest_completed | reconciliation_drift
 * Channels: 'in_app' row + external dispatch (email webhook / Telegram bot),
 * gated per event by the user's notification_preferences (spec §3.9).
 */
export async function notify(userId: string, type: string, title: string, body: string): Promise<void> {
  try {
    const prefs = await getEffectivePrefs(userId)
    const channels = prefs.events[type] ?? DEFAULT_CHANNEL_PREFS
    if (channels.in_app) {
      const { error } = await getServiceClient()
        .from('notifications')
        .insert({ user_id: userId, type, title, body, channel: 'in_app' } as never)
      if (error) logger.warn('notification insert failed', { userId, type, error: error.message })
    }
    if (channels.email || channels.telegram) {
      await dispatchExternal(userId, type, title, body, channels, prefs)
    }
  } catch (err) {
    // Best-effort by contract: notification loss must never break trading flow.
    logger.warn('notify failed', { userId, type, error: (err as Error).message })
  }
}

/** Spec §3.1 audit trail: dot-namespaced event types (auth.login, broker.connected, risk.kill_switch…). */
export async function auditLog(userId: string | null, eventType: string, eventData: Record<string, unknown> = {}): Promise<void> {
  const { error } = await getServiceClient()
    .from('audit_logs')
    .insert({ user_id: userId, event_type: eventType, event_data: eventData } as never)
  if (error) logger.warn('audit insert failed', { userId, eventType, error: error.message })
}
