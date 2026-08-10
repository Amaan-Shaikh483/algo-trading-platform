import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { auditLog } from '../services/userEvents'
import { clearDailyBlock, riskTradingDate, supabaseRiskStore } from '../services/risk/riskManager'
import { executeKillSwitch, releaseKillSwitch } from '../services/risk/killSwitchService'

/**
 * /api/risk — spec §3.7.
 * NOTE (build order): the risk MANAGER + these endpoints landed EARLY at
 * step 7 per the user's explicit safety override ("risk manager wired in
 * before any live order placement code"). Step 9 adds the risk-control UI
 * (settings form, notification preferences) on top of this API.
 */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const riskRouter = Router()

/** GET /api/risk — current limits + today's counters (dashboard/read-model). */
riskRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const store = supabaseRiskStore()
    const [settings, counter] = await Promise.all([store.getSettings(req.userId!), store.getCounter(req.userId!, riskTradingDate())])
    res.json({ settings, today: counter, tradingDate: riskTradingDate() })
  }),
)

/** PUT /api/risk — upsert account limits (positive numbers or null to clear). */
riskRouter.put(
  '/',
  asyncRoute(async (req, res) => {
    const body = req.body as Record<string, unknown>
    const numOrNull = (key: string, max: number): number | null => {
      const v = body[key]
      if (v === null || v === undefined || v === '') return null
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0 || n > max) throw new HttpError(400, `${key} must be a positive number ≤ ${max}`, 'VALIDATION')
      return n
    }
    const settings = {
      user_id: req.userId!,
      max_daily_loss: numOrNull('max_daily_loss', 100_000_000),
      max_trades_per_day: numOrNull('max_trades_per_day', 10_000),
      max_open_positions: numOrNull('max_open_positions', 1_000),
      capital_allocation_limit: numOrNull('capital_allocation_limit', 100_000_000),
    }
    const { data, error } = await getServiceClient()
      .from('user_risk_settings')
      .upsert(settings as never, { onConflict: 'user_id' })
      .select()
      .single()
    if (error) throw new HttpError(500, `risk settings save failed: ${error.message}`)
    await auditLog(req.userId!, 'risk.settings_updated', settings as never)
    res.json(data)
  }),
)

/** POST /api/risk/kill-switch — §3.7 "Stop All & Square Off" (or release). */
riskRouter.post(
  '/kill-switch',
  asyncRoute(async (req, res) => {
    const active = (req.body as { active?: unknown }).active
    if (active === false) {
      await releaseKillSwitch(req.userId!)
      res.json({ killSwitchActive: false })
      return
    }
    const summary = await executeKillSwitch(req.userId!)
    res.json({ killSwitchActive: true, summary })
  }),
)

/** POST /api/risk/unblock — §3.7 manual override for the daily-loss auto-pause. */
riskRouter.post(
  '/unblock',
  asyncRoute(async (req, res) => {
    await clearDailyBlock(req.userId!)
    res.json({ blocked: false, tradingDate: riskTradingDate() })
  }),
)
