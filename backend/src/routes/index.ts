import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { brokerRouter } from './broker'
import { strategiesRouter } from './strategies'
import { instrumentsRouter } from './instruments'
import { watchlistRouter } from './watchlist'
import { backtestsRouter } from './backtests'
import { riskRouter } from './risk'
import { liveRouter } from './live'
import { dashboardRouter } from './dashboard'
import { notificationsRouter } from './notifications'

/**
 * Route registry. HTTP endpoints land per module in Section 6 build order:
 *
 * Step 4  -> /api/broker          (connect/test/disconnect/status — spec 3.2) ✅ LIVE
 * Step 5  -> /api/strategies      (CRUD + clone + toggle   — spec 3.4) ✅ LIVE
 *         -> /api/instruments     (cached search + candles — spec 3.3) ✅ LIVE
 *         -> /api/watchlist       (CRUD + reorder + chart  — spec 3.3) ✅ LIVE
 * Step 6  -> /api/backtests       (queue runs, poll reports — spec 3.5) ✅ LIVE
 * Step 7  -> /api/risk            (kill switch, limits, unblock — spec 3.7; landed
 *                                  EARLY per safety override: risk manager gates
 *                                  every order before any order code exists)  ✅ LIVE
 *         -> /api/live/status     (worker heartbeat / engine online — spec 3.6) ✅ LIVE
 * Step 8  -> /api/dashboard       (P&L/positions/orders/quotes/broker-book — spec 3.8) ✅ LIVE
 * Step 9  -> /api/notifications   (channel preferences + tests — spec 3.9; the
 *                                  risk-control UI consumes /api/risk)       ✅ LIVE
 */
export const apiRouter = Router()

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'algo-trading-platform-backend', ts: new Date().toISOString() })
})

apiRouter.use('/broker', requireAuth, brokerRouter)
apiRouter.use('/strategies', requireAuth, strategiesRouter)
apiRouter.use('/instruments', requireAuth, instrumentsRouter)
apiRouter.use('/watchlist', requireAuth, watchlistRouter)
apiRouter.use('/backtests', requireAuth, backtestsRouter)
apiRouter.use('/risk', requireAuth, riskRouter)
apiRouter.use('/live', requireAuth, liveRouter)
apiRouter.use('/dashboard', requireAuth, dashboardRouter)
apiRouter.use('/notifications', requireAuth, notificationsRouter)
