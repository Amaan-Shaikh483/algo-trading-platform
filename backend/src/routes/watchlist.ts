import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import * as watchlistService from '../services/watchlistService'
import { HttpError } from '../lib/httpError'

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const watchlistRouter = Router()

/** /api/watchlist — CRUD + reorder (spec 3.3). Live LTP attaches in step 7. */

watchlistRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await watchlistService.listWatchlist(req.userId!))
  }),
)

watchlistRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    res.status(201).json(await watchlistService.addWatchlistItem(req.userId!, req.body ?? {}))
  }),
)

watchlistRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    await watchlistService.removeWatchlistItem(req.userId!, req.params.id)
    res.json({ ok: true })
  }),
)

watchlistRouter.patch(
  '/:id/move',
  asyncRoute(async (req, res) => {
    const direction = (req.body as { direction?: unknown })?.direction
    if (direction !== 'up' && direction !== 'down') {
      throw new HttpError(400, "direction must be 'up' or 'down'", 'VALIDATION')
    }
    await watchlistService.moveWatchlistItem(req.userId!, req.params.id, direction)
    res.json({ ok: true })
  }),
)
