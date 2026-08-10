import { getServiceClient } from '../supabase/client'
import { HttpError } from '../lib/httpError'
import { logger } from '../lib/logger'
import type { InstrumentRow } from '../supabase/types'

/**
 * Instrument search & scrip-master cache (spec 3.3).
 * Search hits the cached `instruments` table (pg_trgm indexes), never the
 * live broker API. The table is refreshed daily from Angel One's official
 * scrip master JSON (URL verified against the SmartAPI docs/forum):
 *   https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json
 */

const SCRIP_MASTER_URL =
  process.env.SCRIP_MASTER_URL ?? 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json'

/** exch_seg values to cache (env-tunable; NSE keeps the table lean by default). */
const DEFAULT_EXCH_SEGMENTS = (process.env.INSTRUMENT_SYNC_EXCH_SEG ?? 'NSE,BSE,NFO').split(',').map((s) => s.trim())

const UPSERT_BATCH = 1000

export interface InstrumentHit {
  token: string
  symbol: string
  name: string | null
  exchange: string
  segment: string
  lotsize: number | null
  tick_size: number | null
  expiry: string | null
  strike: number | null
}

/** Keep only PostgREST-safe characters in the free-text search input. */
function sanitizeQuery(q: string): string {
  return q.replace(/[%_,()."\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchInstruments(q: string, opts: { exchange?: string; limit?: number } = {}): Promise<InstrumentHit[]> {
  const cleaned = sanitizeQuery(q)
  if (cleaned.length < 2) return []
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 50)
  const supabase = getServiceClient()

  const base = () =>
    supabase
      .from('instruments')
      .select('token, symbol, name, exchange, segment, lotsize, tick_size, expiry, strike')
      .order('symbol')
      .limit(limit)
  const withExchange = <T extends { eq: (c: string, v: string) => T }>(query: T) =>
    opts.exchange ? query.eq('exchange', opts.exchange) : query

  // Prefix matches rank first; contains-matches top up the remainder.
  const { data: prefix, error: e1 } = await withExchange(
    base().or(`symbol.ilike.${cleaned}%,name.ilike.${cleaned}%`),
  )
  if (e1) throw new HttpError(500, `Instrument search failed: ${e1.message}`)
  if ((prefix?.length ?? 0) >= limit) return (prefix ?? []).slice(0, limit) as InstrumentHit[]

  const seen = new Set((prefix ?? []).map((r) => `${r.exchange}:${r.token}`))
  const { data: contains, error: e2 } = await withExchange(
    base().or(`symbol.ilike.%${cleaned}%,name.ilike.%${cleaned}%`),
  )
  if (e2) throw new HttpError(500, `Instrument search failed: ${e2.message}`)
  const merged = [...(prefix ?? [])]
  for (const row of contains ?? []) {
    const key = `${row.exchange}:${row.token}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
    if (merged.length >= limit) break
  }
  return merged.slice(0, limit) as InstrumentHit[]
}

// ── Scrip-master sync (daily cron job via /internal/jobs/instrument-sync) ───

/** Verified scrip-master record shape (see spec-fidelity notes). */
interface ScripRecord {
  token?: string
  symbol?: string
  name?: string
  expiry?: string
  strike?: string
  lotsize?: string
  instrumenttype?: string
  exch_seg?: string
  tick_size?: string
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

/** "28OCT2025" → "2025-10-28"; empty/invalid → null. */
export function parseAngelExpiry(expiry: string | undefined): string | null {
  const e = (expiry ?? '').trim().toUpperCase()
  const m = /^(\d{2})([A-Z]{3})(\d{4})$/.exec(e)
  if (!m) return null
  const month = MONTHS[m[2]]
  if (!month) return null
  return `${m[3]}-${month}-${m[1]}`
}

function segmentOf(exchSeg: string, instrumenttype: string): 'equity' | 'futures' | 'options' {
  if (exchSeg === 'NSE' || exchSeg === 'BSE') return 'equity'
  if (instrumenttype.startsWith('OPT')) return 'options'
  return 'futures'
}

/** Pure mapping function (unit-testable): scrip record → instruments row. */
export function mapScripRecord(rec: ScripRecord): Omit<InstrumentRow, 'id' | 'updated_at'> | null {
  if (!rec.token || !rec.symbol || !rec.exch_seg) return null
  const strike = Number(rec.strike)
  return {
    token: rec.token,
    symbol: rec.symbol,
    name: rec.name || null,
    exchange: rec.exch_seg,
    segment: segmentOf(rec.exch_seg, rec.instrumenttype ?? ''),
    instrumenttype: rec.instrumenttype || null,
    expiry: parseAngelExpiry(rec.expiry),
    strike: Number.isFinite(strike) && strike >= 0 ? strike : null,
    lotsize: rec.lotsize ? parseInt(rec.lotsize, 10) || null : null,
    tick_size: rec.tick_size ? Number(rec.tick_size) || null : null,
  }
}

export interface InstrumentSyncSummary {
  fetched: number
  mapped: number
  upserted: number
  exchangesIncluded: string[]
  durationMs: number
  dryRun: boolean
}

/**
 * Downloads the scrip master and upserts it into `instruments` in batches.
 * The file is large (100K–1M+ records); filter via INSTRUMENT_SYNC_EXCH_SEG.
 * `maxRecords` exists for smoke-testing without a full load.
 */
export async function syncInstruments(opts: { maxRecords?: number; dryRun?: boolean } = {}): Promise<InstrumentSyncSummary> {
  const started = Date.now()
  logger.info('instrument sync starting', { url: SCRIP_MASTER_URL, exchanges: DEFAULT_EXCH_SEGMENTS })

  const response = await fetch(SCRIP_MASTER_URL)
  if (!response.ok) throw new HttpError(502, `Scrip master download failed (HTTP ${response.status})`, 'SCRIP_FETCH')
  // NOTE: scrip master can be >80MB; JSON.parse of the whole body is a known
  // trade-off — move to a streaming parser if server memory becomes a concern.
  const records = (await response.json()) as ScripRecord[]
  if (!Array.isArray(records)) throw new HttpError(502, 'Scrip master payload was not a JSON array', 'SCRIP_FETCH')

  const allow = new Set(DEFAULT_EXCH_SEGMENTS)
  const seen = new Set<string>()
  const rows: Omit<InstrumentRow, 'id' | 'updated_at'>[] = []
  for (const rec of records) {
    if (!rec.exch_seg || !allow.has(rec.exch_seg)) continue
    const mapped = mapScripRecord(rec)
    if (!mapped) continue
    const key = `${mapped.exchange}:${mapped.token}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(mapped)
    if (opts.maxRecords && rows.length >= opts.maxRecords) break
  }

  let upserted = 0
  if (!opts.dryRun) {
    const supabase = getServiceClient()
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH)
      const { error } = await supabase
        .from('instruments')
        .upsert(batch as never, { onConflict: 'exchange,token', ignoreDuplicates: false })
      if (error) throw new HttpError(500, `Instrument upsert failed at batch ${i / UPSERT_BATCH}: ${error.message}`)
      upserted += batch.length
      if (upserted % 10000 < UPSERT_BATCH) logger.info('instrument sync progress', { upserted, total: rows.length })
    }
  }

  const summary: InstrumentSyncSummary = {
    fetched: records.length,
    mapped: rows.length,
    upserted,
    exchangesIncluded: DEFAULT_EXCH_SEGMENTS,
    durationMs: Date.now() - started,
    dryRun: opts.dryRun === true,
  }
  logger.info('instrument sync completed', { ...summary })
  return summary
}
