import { TIMEFRAMES } from '@algo/rule-schema'
import { HttpError } from '../lib/httpError'
import { fetchHistoricalCandles } from './backtestService'

/**
 * Watchlist / chart candle fetch (spec §3.3 + §3.6).
 *
 * Reuses the same chunked SmartAPI historical path as the backtester so
 * live/backtest/chart bars stay on one clock. Output is already in the
 * shape TradingView Lightweight Charts expects.
 */

const EXCHANGES = new Set(['NSE', 'BSE', 'NFO', 'MCX', 'BFO', 'CDS'])

/** Default lookback — kept inside SmartAPI per-call day caps so a chart load is one chunk. */
export const CHART_LOOKBACK_DAYS: Record<string, number> = {
  '1m': 5,
  '3m': 10,
  '5m': 15,
  '10m': 20,
  '15m': 30,
  '30m': 45,
  '1h': 90,
  '1D': 365,
}

export type ChartBar = {
  /** UTC seconds for intraday; `YYYY-MM-DD` (IST calendar) for daily. */
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartCandlesResult {
  exchange: string
  token: string
  interval: string
  source: 'broker'
  from: string
  to: string
  candles: ChartBar[]
}

export function toChartTime(date: Date, interval: string): number | string {
  if (interval === '1D') {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }
  return Math.floor(date.getTime() / 1000)
}

export function defaultRange(interval: string, now = new Date()): { from: Date; to: Date } {
  const days = CHART_LOOKBACK_DAYS[interval] ?? 15
  return { from: new Date(now.getTime() - days * 86_400_000), to: now }
}

export async function getChartCandles(
  userId: string,
  query: { exchange?: string; token?: string; interval?: string; from?: string; to?: string },
): Promise<ChartCandlesResult> {
  const exchange = (query.exchange ?? '').toUpperCase()
  const token = (query.token ?? '').trim()
  const interval = query.interval ?? '5m'

  if (!EXCHANGES.has(exchange)) throw new HttpError(400, `exchange must be one of ${[...EXCHANGES].join(', ')}`, 'VALIDATION')
  if (!/^\d+$/.test(token)) throw new HttpError(400, 'token must be a numeric symbol token', 'VALIDATION')
  if (!(TIMEFRAMES as readonly string[]).includes(interval)) {
    throw new HttpError(400, `interval must be one of ${TIMEFRAMES.join(', ')}`, 'VALIDATION')
  }

  const fallback = defaultRange(interval)
  const from = query.from ? new Date(query.from) : fallback.from
  const to = query.to ? new Date(query.to) : fallback.to
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'from/to must be valid dates', 'VALIDATION')
  }
  if (from >= to) throw new HttpError(400, '`from` must be before `to`', 'VALIDATION')

  const raw = await fetchHistoricalCandles(userId, {
    exchange,
    symboltoken: token,
    interval,
    from,
    to,
  })

  // LWC requires strictly ascending unique times.
  const byTime = new Map<string | number, ChartBar>()
  for (const c of raw) {
    if (!Number.isFinite(c.open) || !Number.isFinite(c.close)) continue
    const time = toChartTime(c.time, interval)
    byTime.set(time, {
      time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })
  }

  return {
    exchange,
    token,
    interval,
    source: 'broker',
    from: from.toISOString(),
    to: to.toISOString(),
    candles: [...byTime.values()],
  }
}
