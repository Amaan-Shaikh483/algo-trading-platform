import type { Candle } from '../brokers/types'

/**
 * Tick → candle aggregation (spec §3.6 "rolling in-memory candle buffer").
 *
 * Buckets follow the Indian market session, computed with a FIXED +05:30
 * offset (IST has no DST):
 *   - intraday frames start at 09:15 IST and tile by the interval —
 *     e.g. 5m → 09:15, 09:20, …; 1h → 09:15, 10:15, …, 15:15 (a 15-minute
 *     tail), mirroring SmartAPI historical candle conventions;
 *   - '1D' → one session candle [09:15, 15:30];
 *   - ticks outside 09:15–15:30 IST are ignored for candle building;
 *   - a candle CLOSES when the first tick of a later bucket arrives or when
 *     `sweep(now)` sees wall-clock cross the bucket end (the worker sweeps
 *     every second; closes therefore fire within ~1s of the real boundary).
 */

export const MARKET_OPEN_MIN = 9 * 60 + 15 // 09:15 IST
export const MARKET_CLOSE_MIN = 15 * 60 + 30 // 15:30 IST
const IST_OFFSET_MS = 5.5 * 3600 * 1000

export const TIMEFRAME_MINUTES: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '10m': 10,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '1D': MARKET_CLOSE_MIN - MARKET_OPEN_MIN, // 375 — whole session
}

/** IST wall-clock ms, as epoch ms (fixed offset arithmetic, DST-free). */
function istParts(ms: number): { dayStartMs: number; minuteOfDay: number } {
  const shifted = ms + IST_OFFSET_MS
  const day = Math.floor(shifted / 86400000)
  return { dayStartMs: day * 86400000 - IST_OFFSET_MS, minuteOfDay: Math.floor((shifted % 86400000) / 60000) }
}

/** Bucket start (epoch ms) for a tick time, or null when outside the session. */
export function bucketStartFor(ms: number, timeframeMinutes: number): number | null {
  const { dayStartMs, minuteOfDay } = istParts(ms)
  if (minuteOfDay < MARKET_OPEN_MIN || minuteOfDay >= MARKET_CLOSE_MIN) return null
  const idx = Math.floor((minuteOfDay - MARKET_OPEN_MIN) / timeframeMinutes)
  return dayStartMs + (MARKET_OPEN_MIN + idx * timeframeMinutes) * 60000
}

export class CandleAggregator {
  private current: Candle | null = null
  private bucketStart: number | null = null
  private readonly bucketMs: number

  constructor(
    timeframe: string,
    private readonly onClose: (candle: Candle) => void,
  ) {
    const minutes = TIMEFRAME_MINUTES[timeframe]
    if (!minutes) throw new Error(`unsupported timeframe: ${timeframe}`)
    this.bucketMs = minutes * 60000
    this.timeframeMinutes = minutes
  }

  private readonly timeframeMinutes: number

  /** Feed a tick; emits at most one close when the tick crosses a bucket boundary. */
  addTick(ts: number, price: number, qty = 0): void {
    if (!Number.isFinite(price) || price <= 0) return
    const bucket = bucketStartFor(ts, this.timeframeMinutes)
    if (bucket == null) return // outside market session
    if (this.bucketStart == null || bucket > this.bucketStart) {
      if (this.current) this.onClose(this.current)
      this.bucketStart = bucket
      this.current = { time: new Date(bucket), open: price, high: price, low: price, close: price, volume: qty }
      return
    }
    if (bucket < this.bucketStart) return // stale/late tick for an old bucket — drop
    const c = this.current!
    c.high = Math.max(c.high, price)
    c.low = Math.min(c.low, price)
    c.close = price
    c.volume += qty
  }

  /**
   * Wall-clock close check (call every ~1s): closes the current bucket once
   * its end has passed — no next-bucket tick required (handles lunch-hour
   * illiquidity and clean 15:30 close).
   */
  sweep(nowMs = Date.now()): void {
    if (this.current == null || this.bucketStart == null) return
    if (this.bucketStart + this.bucketMs <= nowMs) {
      this.onClose(this.current)
      this.current = null
      this.bucketStart = null
    }
  }

  /** End-of-process flush (does NOT emit): discard partial bucket. */
  dropPartial(): void {
    this.current = null
    this.bucketStart = null
  }
}
