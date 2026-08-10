import { getServiceClient } from '../supabase/client'
import { logger } from '../lib/logger'
import { syncInstruments } from './instrumentService'

/**
 * Zero-touch instrument-cache bootstrap (ops convenience; the daily 06:00 IST
 * pg_cron → /internal/jobs/instrument-sync remains the canonical refresh).
 *
 * On backend boot, in the BACKGROUND (never blocking listen), check the cache:
 *   - empty table                    → full scrip-master sync now
 *   - cache older than STALE_HOURS   → background refresh now
 *   - fresh                          → do nothing
 * This removes the manual curl step on fresh locals/dev machines; on the VPS
 * the daily cron keeps the table fresh so boot-sync almost always no-ops.
 *
 * Env:
 *   INSTRUMENT_BOOT_SYNC = stale (default) | empty | off
 *   INSTRUMENT_STALE_HOURS = 20 (default ~"synced within the last day")
 */
const MODE = (process.env.INSTRUMENT_BOOT_SYNC ?? 'stale').toLowerCase()
const STALE_HOURS = parseFloat(process.env.INSTRUMENT_STALE_HOURS ?? '20')

export function scheduleInstrumentBootstrap(): void {
  if (MODE === 'off') return
  setTimeout(() => {
    void (async () => {
      try {
        const supabase = getServiceClient()
        const { count, error } = await supabase
          .from('instruments')
          .select('id', { count: 'exact', head: true })
        if (error) {
          logger.warn('instrument bootstrap: could not read cache count; skipping', { error: error.message })
          return
        }
        const cached = count ?? 0
        if (cached > 0 && MODE === 'empty') {
          logger.info('instrument bootstrap: cache populated; skipping sync', { cached })
          return
        }
        if (cached > 0 && MODE === 'stale') {
          const { data: latest, error: staleErr } = await supabase
            .from('instruments')
            .select('updated_at')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (staleErr) {
            logger.warn('instrument bootstrap: could not read cache freshness; skipping', { error: staleErr.message })
            return
          }
          const ageMs = latest?.updated_at ? Date.now() - new Date(latest.updated_at as string).getTime() : Number.POSITIVE_INFINITY
          if (ageMs < STALE_HOURS * 3_600_000) {
            logger.info('instrument bootstrap: cache fresh; skipping sync', {
              cached,
              ageHours: Math.round(ageMs / 3_600_000),
            })
            return
          }
        }
        logger.info('instrument bootstrap: starting background scrip-master sync', { mode: MODE, cached })
        const summary = await syncInstruments()
        logger.info('instrument bootstrap: sync complete', summary as unknown as Record<string, unknown>)
      } catch (err) {
        logger.error('instrument bootstrap: sync failed (search may return no matches until the cron or a manual run succeeds)', {
          error: (err as Error).message,
        })
      }
    })()
  }, 2_000) // let the server finish binding before the ~100MB download starts
}
