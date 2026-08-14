import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'
import { HttpError } from '../lib/httpError'
import { refreshAllConnections } from '../services/brokerConnectionService'
import { syncInstruments } from '../services/instrumentService'
import { drainQueue } from '../services/backtestService'

/**
 * /internal — machine-to-machine endpoints invoked by Supabase cron edge
 * functions. NOT user-authenticated; guarded by the shared CRON_SECRET header.
 */
export const internalRouter = Router()

function requireCronSecret(req: Request, _res: Response, next: NextFunction): void {
  const provided = req.headers['x-cron-secret']
  if (typeof provided !== 'string' || provided !== env.cronSecret()) {
    next(new HttpError(401, 'Invalid cron secret', 'UNAUTHORIZED'))
    return
  }
  next()
}

internalRouter.use(requireCronSecret)

/** Spec 3.2: pre-market (08:00 IST) daily re-login for all active connections. */
internalRouter.post('/jobs/token-refresh', (_req, res, next) => {
  refreshAllConnections()
    .then((summary) => res.json(summary))
    .catch(next)
})

/**
 * DEPRECATED: Scrip-master sync endpoint disabled.
 * 
 * The instruments table is now manually seeded with 4 option indices only.
 * This endpoint is kept for backwards compatibility but returns a deprecated message.
 */
internalRouter.post('/jobs/instrument-sync', (_req, res) => {
  res.json({
    deprecated: true,
    message: 'Angel Broking scrip master sync has been disabled. Instruments table is manually seeded with 4 option indices.',
    fetched: 0,
    mapped: 0,
    upserted: 0,
    exchangesIncluded: [],
    durationMs: 0,
    dryRun: false,
  })
})

/**
 * Backtest queue sweeper (runs are already kicked in-process on creation;
 * this drains anything orphaned by a crash/restart). Schedule every minute.
 */
internalRouter.post('/jobs/run-backtests', (_req, res, next) => {
  drainQueue()
    .then((summary) => res.json(summary))
    .catch(next)
})
