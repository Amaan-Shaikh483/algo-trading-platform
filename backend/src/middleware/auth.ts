import type { Request, Response, NextFunction } from 'express'
import { verifyUserJwt } from '../supabase/client'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

/**
 * Spec 3.1: the frontend holds a Supabase JWT; every backend route verifies
 * it here (validated against Supabase Auth — signature AND expiry), then
 * exposes the user id as req.userId.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <jwt> header' })
    return
  }
  const userId = await verifyUserJwt(header.slice('Bearer '.length))
  if (!userId) {
    res.status(401).json({ error: 'Invalid or expired session token' })
    return
  }
  req.userId = userId
  next()
}
