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
 * Spec 3.3: daily scrip-master → instruments table sync.
 * Query opts (for ops): ?maxRecords=500 (smoke test) · ?dryRun=1 (validate + count only).
 */
internalRouter.post('/jobs/instrument-sync', (req, res, next) => {
  const maxRecords = typeof req.query.maxRecords === 'string' ? parseInt(req.query.maxRecords, 10) : undefined
  const dryRun = req.query.dryRun === '1'
  syncInstruments({ maxRecords: Number.isFinite(maxRecords) ? maxRecords : undefined, dryRun })
    .then((summary) => res.json(summary))
    .catch(next)
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
