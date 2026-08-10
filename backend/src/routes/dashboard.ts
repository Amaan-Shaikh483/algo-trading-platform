import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { HttpError } from '../lib/httpError'
import * as dashboardService from '../services/dashboardService'

/**
 * /api/dashboard — spec §3.8 read model. Client-side freshness comes from
 * Supabase Realtime on the engine tables; broker-side slices have their own
 * short caches + manual refresh.
 */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const dashboardRouter = Router()

dashboardRouter.get(
  '/summary',
  asyncRoute(async (req, res) => {
    const [positions, realizedToday] = await Promise.all([
      dashboardService.getDashboardPositions(req.userId!),
      dashboardService.getTodayRealized(req.userId!),
    ])
    res.json({ positions, realizedToday })
  }),
)

dashboardRouter.get(
  '/orders',
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000)
    res.json(await dashboardService.getDashboardOrders(req.userId!, limit))
  }),
)

dashboardRouter.get(
  '/trades',
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000)
    res.json(await dashboardService.getDashboardTrades(req.userId!, limit))
  }),
)

/** Quotes for arbitrary tokens: ?symbols=NSE:3045,NSE:99926000&mode=LTP|OHLC|FULL */
dashboardRouter.get(
  '/quotes',
  asyncRoute(async (req, res) => {
    const raw = typeof req.query.symbols === 'string' ? req.query.symbols : ''
    const mode = req.query.mode === 'FULL' || req.query.mode === 'OHLC' ? req.query.mode : 'LTP'
    const items = raw
      .split(',')
      .map((s) => s.trim().split(':'))
      .filter((parts) => parts.length === 2 && parts[0] && /^\d+$/.test(parts[1]))
      .slice(0, 100)
      .map(([exchange, token]) => ({ exchange, token }))
    if (items.length === 0) throw new HttpError(400, 'symbols must look like NSE:3045,NFO:12345', 'VALIDATION')
    res.json(await dashboardService.getQuotes(req.userId!, items, mode))
  }),
)

/** Broker position/holding/funds book (?refresh=1 bypasses the 20s cache). */
dashboardRouter.get(
  '/broker-book',
  asyncRoute(async (req, res) => {
    res.json(await dashboardService.getBrokerBook(req.userId!, req.query.refresh === '1'))
  }),
)
