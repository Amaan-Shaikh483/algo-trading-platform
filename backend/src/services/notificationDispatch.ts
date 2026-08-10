import { getServiceClient } from '../supabase/client'
import { logger } from '../lib/logger'
import { env } from '../config/env'

/**
 * Spec §3.9 — notification event catalog, per-user channel preferences, and
 * the external-channel dispatchers (email webhook / Telegram bot).
 *
 * Delivery model (honest-by-design):
 *  - in_app     → row in `notifications` (powers the realtime notification
 *                 center) — always available, the channel of record.
 *  - telegram   → live Bot API sendMessage when the backend has
 *                 TELEGRAM_BOT_TOKEN and the user has linked a chat ID.
 *  - email      → transactional email needs a provider (Resend/SES/…). Instead
 *                 of faking it, we POST the event to NOTIFY_EMAIL_WEBHOOK_URL;
 *                 point that at a Supabase Edge Function that resolves the
 *                 user's email (auth admin) and calls the provider. Until the
 *                 env is set, the preference is stored but delivery is skipped
 *                 (and the UI says so).
 *
 * Everything here is best-effort: a notification failure must never break a
 * trading-safety code path, so callers wrap us in try/catch and we never throw
 * from `dispatchExternal`.
 */

export interface ChannelPrefs {
  in_app: boolean
  email: boolean
  telegram: boolean
}

export interface NotificationEventInfo {
  type: string
  label: string
  description: string
  /** Critical events are recommended to keep on every channel (UI marks them). */
  critical?: boolean
}

/** §3.9 trigger events (superset incl. the platform's own operational events). */
export const NOTIFICATION_EVENTS: NotificationEventInfo[] = [
  { type: 'order_placed', label: 'Order placed', description: 'An entry or exit order was sent to the broker (live) or simulated (paper mode).' },
  { type: 'order_filled', label: 'Order filled / position closed', description: 'A fill was recorded — position opened, or closed with realized P&L.' },
  { type: 'order_rejected', label: 'Order rejected / risk-blocked', description: 'The broker rejected an order, or the Risk Manager blocked it at the gate.', critical: true },
  { type: 'sl_hit', label: 'Stop-loss hit', description: 'A position was closed by its stop-loss (including trailing stop-loss).' },
  { type: 'target_hit', label: 'Target hit', description: 'A position was closed at its profit target.' },
  { type: 'daily_loss_limit', label: 'Daily loss limit reached', description: 'Auto-pause fired: live entries are blocked until the next trading day or manual override.', critical: true },
  { type: 'strategy_error', label: 'Strategy runtime error', description: 'A strategy failed to start, or an error occurred while it was running.', critical: true },
  { type: 'token_expired', label: 'Broker token expired', description: 'Daily auto re-login failed — reconnect with your MPIN on the Broker page.', critical: true },
  { type: 'kill_switch', label: 'Kill switch', description: 'Stop All & Square Off was activated (or released).', critical: true },
  { type: 'backtest_completed', label: 'Backtest completed', description: 'A queued backtest finished and the report is ready to view.' },
  { type: 'reconciliation_drift', label: 'Reconciliation drift', description: 'Broker-side state diverged from the engine — e.g. a manual trade on the broker app.' },
]

const KNOWN_TYPES = new Set(NOTIFICATION_EVENTS.map((e) => e.type))
export function isKnownEventType(type: string): boolean {
  return KNOWN_TYPES.has(type)
}

export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = { in_app: true, email: false, telegram: false }

export interface EffectivePrefs {
  telegram_chat_id: string | null
  /** Merged per-event channel map; unknown/absent events fall back to defaults. */
  events: Record<string, ChannelPrefs>
}

export function defaultPrefs(): EffectivePrefs {
  const events: Record<string, ChannelPrefs> = {}
  for (const e of NOTIFICATION_EVENTS) events[e.type] = { ...DEFAULT_CHANNEL_PREFS }
  return { telegram_chat_id: null, events }
}

function mergePrefsRow(row: { telegram_chat_id: string | null; prefs: unknown } | null): EffectivePrefs {
  const merged = defaultPrefs()
  if (!row) return merged
  merged.telegram_chat_id = row.telegram_chat_id
  const stored = (row.prefs ?? {}) as Record<string, Partial<Record<keyof ChannelPrefs, unknown>>>
  for (const type of Object.keys(stored)) {
    if (!KNOWN_TYPES.has(type)) continue
    const base = merged.events[type] ?? { ...DEFAULT_CHANNEL_PREFS }
    for (const ch of ['in_app', 'email', 'telegram'] as const) {
      const v = stored[type]?.[ch]
      if (typeof v === 'boolean') base[ch] = v
    }
    merged.events[type] = base
  }
  return merged
}

/* ── Prefs cache (notify() is on hot order paths — no per-call DB round trip) ── */

const CACHE_TTL_MS = 30_000
const prefsCache = new Map<string, { at: number; prefs: EffectivePrefs }>()

export function invalidatePrefsCache(userId: string): void {
  prefsCache.delete(userId)
}

/**
 * Load effective prefs. Fail-OPEN to defaults (in_app on): losing an alert
 * because the prefs table hiccuped is worse than delivering one extra alert.
 */
export async function getEffectivePrefs(userId: string): Promise<EffectivePrefs> {
  const hit = prefsCache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.prefs
  try {
    const { data, error } = await getServiceClient()
      .from('notification_preferences')
      .select('telegram_chat_id, prefs')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const prefs = mergePrefsRow(data)
    prefsCache.set(userId, { at: Date.now(), prefs })
    return prefs
  } catch (err) {
    logger.warn('notification prefs load failed; using defaults', { userId, error: (err as Error).message })
    return defaultPrefs()
  }
}

/* ── External channel senders ── */

async function postJsonWithTimeout(url: string, payload: Record<string, unknown>, timeoutMs = 6_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = env.telegramBotToken()
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured on the backend')
  const res = await postJsonWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (!res.ok || json.ok !== true) throw new Error(`Telegram API error ${res.status}: ${json.description ?? res.statusText}`)
}

export async function sendEmailWebhook(userId: string, type: string, title: string, body: string): Promise<void> {
  const url = env.notifyEmailWebhook()
  if (!url) throw new Error('NOTIFY_EMAIL_WEBHOOK_URL is not configured on the backend')
  const res = await postJsonWithTimeout(url, { userId, type, title, body, at: new Date().toISOString() })
  if (!res.ok) throw new Error(`email webhook responded ${res.status}`)
}

/**
 * Fire the external channels enabled for this event. Never throws — failures
 * are logged with the channel name so operators can spot a dead provider.
 */
export async function dispatchExternal(
  userId: string,
  type: string,
  title: string,
  body: string,
  channels: ChannelPrefs,
  prefs: EffectivePrefs,
): Promise<void> {
  const jobs: Promise<void>[] = []
  if (channels.telegram && prefs.telegram_chat_id) {
    jobs.push(
      sendTelegram(prefs.telegram_chat_id, `${title}\n${body}`.slice(0, 4000)).catch((err) =>
        logger.warn('telegram dispatch failed', { userId, type, error: (err as Error).message }),
      ),
    )
  }
  if (channels.email) {
    jobs.push(
      sendEmailWebhook(userId, type, title, body).catch((err) =>
        logger.warn('email dispatch failed', { userId, type, error: (err as Error).message }),
      ),
    )
  }
  await Promise.all(jobs)
}
