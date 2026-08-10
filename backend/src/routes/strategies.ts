import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import * as strategyService from '../services/strategyService'
import { HttpError } from '../lib/httpError'

/** /api/strategies — CRUD + lifecycle (spec 3.4). JWT required (mounted behind requireAuth). */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const strategiesRouter = Router()

strategiesRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await strategyService.listStrategies(req.userId!))
  }),
)

strategiesRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json(await strategyService.getStrategy(req.userId!, req.params.id))
  }),
)

strategiesRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const { name, description, instrument, symbolToken, exchange, segment, timeframe, rules } = (req.body ?? {}) as Record<string, never>
    res.status(201).json(
      await strategyService.createStrategy(req.userId!, { name, description, instrument, symbolToken, exchange, segment, timeframe, rules }),
    )
  }),
)

strategiesRouter.put(
  '/:id',
  asyncRoute(async (req, res) => {
    const { name, description, instrument, symbolToken, exchange, segment, timeframe, rules } = (req.body ?? {}) as Record<string, never>
    res.json(
      await strategyService.updateStrategy(req.userId!, req.params.id, {
        name, description, instrument, symbolToken, exchange, segment, timeframe, rules,
      }),
    )
  }),
)

strategiesRouter.post(
  '/:id/clone',
  asyncRoute(async (req, res) => {
    res.status(201).json(await strategyService.cloneStrategy(req.userId!, req.params.id))
  }),
)

strategiesRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    await strategyService.deleteStrategy(req.userId!, req.params.id)
    res.json({ ok: true })
  }),
)

strategiesRouter.post(
  '/:id/toggle',
  asyncRoute(async (req, res) => {
    const active = (req.body as { active?: unknown })?.active
    if (typeof active !== 'boolean') throw new HttpError(400, 'body.active (boolean) is required', 'VALIDATION')
    res.json(await strategyService.setActive(req.userId!, req.params.id, active))
  }),
)

strategiesRouter.patch(
  '/:id/mode',
  asyncRoute(async (req, res) => {
    const { mode, confirm } = (req.body ?? {}) as { mode?: 'paper' | 'live'; confirm?: unknown }
    if (mode !== 'paper' && mode !== 'live') throw new HttpError(400, "mode must be 'paper' or 'live'", 'VALIDATION')
    res.json(await strategyService.setMode(req.userId!, req.params.id, mode, confirm))
  }),
)
