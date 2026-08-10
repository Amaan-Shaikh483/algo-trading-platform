import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { searchInstruments } from '../services/instrumentService'

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
