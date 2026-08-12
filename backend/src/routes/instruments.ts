import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { searchInstruments } from '../services/instrumentService'
import { getChartCandles } from '../services/chartService'

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const instrumentsRouter = Router()

/** GET /api/instruments/search?q=sbin&exchange=NSE&limit=15 — cached-table search (spec 3.3). */
instrumentsRouter.get(
  '/search',
  asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const exchange = typeof req.query.exchange === 'string' ? req.query.exchange : undefined
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined
    res.json(await searchInstruments(q, { exchange, limit: Number.isFinite(limit) ? limit : undefined }))
  }),
)

/** GET /api/instruments/candles?exchange=NSE&token=3045&interval=5m — OHLCV for the watchlist chart. */
instrumentsRouter.get(
  '/candles',
  asyncRoute(async (req, res) => {
    const exchange = typeof req.query.exchange === 'string' ? req.query.exchange : ''
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    const interval = typeof req.query.interval === 'string' ? req.query.interval : undefined
    const from = typeof req.query.from === 'string' ? req.query.from : undefined
    const to = typeof req.query.to === 'string' ? req.query.to : undefined
    res.json(await getChartCandles(req.userId!, { exchange, token, interval, from, to }))
  }),
)
