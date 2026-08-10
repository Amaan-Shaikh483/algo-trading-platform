import { logger } from '../lib/logger'
import { refreshAllConnections } from './brokerConnectionService'

/**
 * Zero-touch session bootstrap (ops convenience; the 08:00 IST pg_cron → edge →
 * /internal/jobs path remains the canonical DAILY refresh on deployed setups).
 *
 * Problem this solves: SmartAPI JWTs die at midnight. On a LOCAL dev machine
 * the Supabase cloud cron cannot reach localhost:4000, so mornings show stale
 * sessions + failed auto-re-logins until a manual MPIN reconnect.
 *
 * Fix: whenever the backend boots, attempt the same refreshAllConnections()
 * the cron uses — refresh-token minting needs no MPIN, so a morning backend
 * restart silently repairs yesterday's session. Connections whose refresh
 * token is genuinely stale are marked token_expired + notified (unchanged),
 * and the UI's Reconnect-with-MPIN card remains the final fallback.
 *
 * Runs in the BACKGROUND (never blocks listen). Env:
 *   BROKER_SESSION_REFRESH_ON_BOOT = 1 (default) | 0
 */
const REFRESH_ON_BOOT = (process.env.BROKER_SESSION_REFRESH_ON_BOOT ?? '1') !== '0'

export function scheduleSessionBootstrap(): void {
  if (!REFRESH_ON_BOOT) return
  setTimeout(() => {
    void (async () => {
      try {
        const summary = await refreshAllConnections()
        logger.info('session bootstrap: boot-time token refresh completed', { ...summary })
      } catch (err) {
        logger.error('session bootstrap: boot-time refresh failed (cron/manual reconnect still available)', {
          error: (err as Error).message,
        })
      }
    })()
  }, 3_000) // let the server finish binding before broker traffic starts
}
