import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { getServiceClient } from '../supabase/client'

/**
 * /api/live — engine status read-model (§3.6; powers the step-8 dashboard
 * "engine online" widget; surfaces worker heartbeat + per-user feed health).
 */

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
  }

export const liveRouter = Router()

liveRouter.get(
  '/status',
  asyncRoute(async (_req, res) => {
    const { data, error } = await getServiceClient()
      .from('worker_heartbeats')
      .select('*')
      .eq('worker', 'live-engine')
      .maybeSingle()
    if (error) throw error
    const ageSec = data ? Math.round((Date.now() - new Date(data.updated_at).getTime()) / 1000) : null
    res.json({
      online: ageSec != null && ageSec < 45,
      heartbeatAgeSec: ageSec,
      heartbeatAt: data?.updated_at ?? null,
      state: data?.state ?? null,
    })
  }),
)
