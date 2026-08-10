import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { auditLog } from '../services/userEvents'
import {
  NOTIFICATION_EVENTS,
  defaultPrefs,
  getEffectivePrefs,
  invalidatePrefsCache,
  isKnownEventType,
  sendEmailWebhook,
  sendTelegram,
} from '../services/notificationDispatch'
import type { ChannelPrefs } from '../services/notificationDispatch'
import { env } from '../config/env'

/**
 * /api/notifications — spec §3.9 notification preferences + channel tests.
 *
 * The notification CENTER (list + mark-read) is served by the frontend
 * directly against the `notifications` table via Supabase (RLS: own rows
 * only) + Realtime — no polling, per spec. Preferences go through this API
 * because the row is upserted server-side (RLS has no INSERT policy; the
 * default row is created by the signup trigger) and so the prefs cache used
 * by notify() can be invalidated immediately.
 */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

const CHANNELS = ['in_app', 'email', 'telegram'] as const

function channelStatus() {
  return {
    telegramConfigured: env.telegramBotToken() !== '',
    emailConfigured: env.notifyEmailWebhook() !== '',
  }
}

export const notificationsRouter = Router()

/** GET /api/notifications/preferences — event catalog + effective prefs + channel wiring status. */
notificationsRouter.get(
  '/preferences',
  asyncRoute(async (req, res) => {
    const prefs = await getEffectivePrefs(req.userId!)
    res.json({ events: NOTIFICATION_EVENTS, prefs, channels: channelStatus() })
  }),
)

/** PUT /api/notifications/preferences — save telegram chat id + per-event channel toggles. */
notificationsRouter.put(
  '/preferences',
  asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown>

    let telegramChatId: string | null = null
    if (body.telegram_chat_id !== undefined && body.telegram_chat_id !== null) {
      if (typeof body.telegram_chat_id !== 'string' || body.telegram_chat_id.length > 64) {
        throw new HttpError(400, 'telegram_chat_id must be a string ≤ 64 chars', 'VALIDATION')
      }
      telegramChatId = body.telegram_chat_id.trim() || null
    } else {
      // Field omitted → keep the stored value.
      const current = await getEffectivePrefs(req.userId!)
      telegramChatId = current.telegram_chat_id
    }

    const stored: Record<string, ChannelPrefs> = {}
    const eventsInput = (body.events ?? {}) as Record<string, Record<string, unknown>>
    if (typeof eventsInput !== 'object' || eventsInput === null || Array.isArray(eventsInput)) {
      throw new HttpError(400, 'events must be an object keyed by event type', 'VALIDATION')
    }
    for (const [type, channels] of Object.entries(eventsInput)) {
      if (!isKnownEventType(type)) throw new HttpError(400, `unknown event type: ${type}`, 'VALIDATION')
      const merged = { ...defaultPrefs().events[type] }
      for (const ch of CHANNELS) {
        const v = channels?.[ch]
        if (v === undefined) continue
        if (typeof v !== 'boolean') throw new HttpError(400, `events.${type}.${ch} must be boolean`, 'VALIDATION')
        merged[ch] = v
      }
      stored[type] = merged
    }

    const { error } = await getServiceClient()
      .from('notification_preferences')
      .upsert(
        { user_id: req.userId!, telegram_chat_id: telegramChatId, prefs: stored } as never,
        { onConflict: 'user_id' },
      )
    if (error) throw new HttpError(500, `preferences save failed: ${error.message}`)

    invalidatePrefsCache(req.userId!)
    const toggles = Object.values(stored).reduce((n, c) => n + Object.values(c).filter(Boolean).length, 0)
    await auditLog(req.userId!, 'notifications.prefs_updated', { toggles, telegramLinked: telegramChatId != null })
    res.json({ events: NOTIFICATION_EVENTS, prefs: await getEffectivePrefs(req.userId!), channels: channelStatus() })
  }),
)

/**
 * POST /api/notifications/test { channel: 'email' | 'telegram' } — send a test
 * message through the channel so the user can verify wiring. Returns
 * { sent, reason? } instead of an error status: "not configured" is an
 * expected state, surfaced honestly in the UI.
 */
notificationsRouter.post(
  '/test',
  asyncRoute(async (req, res) => {
    const channel = (req.body as { channel?: unknown }).channel
    if (channel !== 'email' && channel !== 'telegram') {
      throw new HttpError(400, "channel must be 'email' or 'telegram'", 'VALIDATION')
    }
    const prefs = await getEffectivePrefs(req.userId!)
    try {
      if (channel === 'telegram') {
        if (!prefs.telegram_chat_id) {
          res.json({ sent: false, reason: 'Save your Telegram chat ID first' })
          return
        }
        await sendTelegram(prefs.telegram_chat_id, '✅ AlgoTrading test notification — your Telegram channel is wired up.')
      } else {
        await sendEmailWebhook(req.userId!, 'test', 'AlgoTrading test notification', 'Your email channel is wired up.')
      }
      res.json({ sent: true })
    } catch (err) {
      res.json({ sent: false, reason: (err as Error).message })
    }
  }),
)
