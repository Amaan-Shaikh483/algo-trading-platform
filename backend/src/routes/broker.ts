import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import * as brokerConnectionService from '../services/brokerConnectionService'

/**
 * /api/broker — the Connect Broker flow (spec 3.2). All routes require the
 * user's Supabase JWT (mounted behind requireAuth in routes/index.ts).
 * Secrets entered here travel only frontend → backend over HTTPS, are used
 * server-side, and stored AES-256-GCM encrypted; GET responses never contain
 * secrets.
 */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const brokerRouter = Router()

/** Test credentials against SmartAPI without saving anything. */
brokerRouter.post(
  '/test',
  asyncRoute(async (req, res) => {
    const result = await brokerConnectionService.testConnection(req.userId!, req.body)
    res.json(result)
  }),
)

/** Save credentials (encrypted) + login + persist session tokens. */
brokerRouter.post(
  '/connect',
  asyncRoute(async (req, res) => {
    const result = await brokerConnectionService.connect(req.userId!, req.body)
    res.json(result)
  }),
)

/** Current connection status/profile for the badge + card. */
brokerRouter.get(
  '/status',
  asyncRoute(async (req, res) => {
    res.json(await brokerConnectionService.getStatus(req.userId!))
  }),
)

/** Re-login with stored credentials + a freshly entered MPIN. */
brokerRouter.post(
  '/reconnect',
  asyncRoute(async (req, res) => {
    res.json(await brokerConnectionService.reconnect(req.userId!, req.body))
  }),
)

/** Clear tokens; keep credentials + history. */
brokerRouter.post(
  '/disconnect',
  asyncRoute(async (req, res) => {
    res.json(await brokerConnectionService.disconnect(req.userId!))
  }),
)

/** Delete the connection entirely (incl. stored encrypted credentials). */
brokerRouter.delete(
  '/',
  asyncRoute(async (req, res) => {
    res.json(await brokerConnectionService.remove(req.userId!))
  }),
)
