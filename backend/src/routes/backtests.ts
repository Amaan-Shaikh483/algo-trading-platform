import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import * as backtestService from '../services/backtestService'

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const backtestsRouter = Router()

/** /api/backtests — queue runs, poll status/worker output (spec §3.5). */

backtestsRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await backtestService.listRuns(req.userId!))
  }),
)

backtestsRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json(await backtestService.getRun(req.userId!, req.params.id))
  }),
)

backtestsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    res.status(202).json(await backtestService.createRun(req.userId!, req.body))
  }),
)

backtestsRouter.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    await backtestService.deleteRun(req.userId!, req.params.id)
    res.json({ ok: true })
  }),
)
