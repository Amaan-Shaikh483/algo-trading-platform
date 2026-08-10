import { describe, expect, it } from 'vitest'
import {
  formatCandleDate,
  MARKET_DATA_MAX_TOKENS_PER_REQUEST,
  SESSION_ERROR_CODES,
  splitExchangeTokens,
} from './angelOneService'

/**
 * Pure-helper coverage for the Angel One adapter (spec §6 step 10 + API
 * validation sweep 2026-08-06). Network-bound paths stay covered by the
 * integration harnesses (scripts/verify-*.mjs).
 */

describe('SESSION_ERROR_CODES (official Error Codes doc)', () => {
  it('contains all three token/session codes', () => {
    expect(SESSION_ERROR_CODES.has('AG8001')).toBe(true) // Invalid Token
    expect(SESSION_ERROR_CODES.has('AG8002')).toBe(true) // Token Expired
    expect(SESSION_ERROR_CODES.has('AG8003')).toBe(true) // Token missing
  })

  it('does not swallow unrelated error codes', () => {
    expect(SESSION_ERROR_CODES.has('AB1004')).toBe(false)
    expect(SESSION_ERROR_CODES.has('AB4008')).toBe(false)
    expect(SESSION_ERROR_CODES.has('AB8050')).toBe(false) // refresh-token errors flow via refreshSession
  })
})

describe('splitExchangeTokens (MarketData doc: ≤50 tokens per request)', () => {
  const tokens = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

  it('keeps a small request in a single chunk', () => {
    const out = splitExchangeTokens({ NSE: ['3045', '881'], NFO: ['58662'] })
    expect(out).toEqual([{ NSE: ['3045', '881'], NFO: ['58662'] }])
  })

  it('returns an empty list for an empty request', () => {
    expect(splitExchangeTokens({})).toEqual([])
    expect(splitExchangeTokens({ NSE: [] })).toEqual([])
  })

  it('never exceeds the per-request cap', () => {
    const out = splitExchangeTokens({ NSE: tokens('T', 120) })
    expect(out.length).toBe(3) // 50 + 50 + 20
    for (const chunk of out) {
      const size = Object.values(chunk).reduce((sum, t) => sum + t.length, 0)
      expect(size).toBeLessThanOrEqual(MARKET_DATA_MAX_TOKENS_PER_REQUEST)
    }
  })

  it('counts tokens across exchanges toward the shared 50-token budget', () => {
    const out = splitExchangeTokens({ NSE: tokens('N', 30), NFO: tokens('F', 30) })
    expect(out.length).toBe(2) // 30 NSE + 20 NFO, then 10 NFO
    const merged = out.flatMap((chunk) => Object.values(chunk).flat())
    expect(merged).toHaveLength(60)
  })

  it('preserves every token exactly once, in order', () => {
    const input = { NSE: tokens('N', 75), BSE: tokens('B', 75) }
    const out = splitExchangeTokens(input)
    const perExchange: Record<string, string[]> = {}
    for (const chunk of out) {
      for (const [exchange, toks] of Object.entries(chunk)) (perExchange[exchange] ??= []).push(...toks)
    }
    expect(perExchange).toEqual(input)
  })
})

describe('formatCandleDate (Historical doc: "YYYY-MM-DD HH:mm" IST)', () => {
  it('formats a UTC instant in IST trading-time', () => {
    // 2021-01-01 03:45 UTC == 2021-01-01 09:15 IST (market open)
    expect(formatCandleDate(new Date('2021-01-01T03:45:00Z'))).toBe('2021-01-01 09:15')
  })

  it('rolls the date forward when IST crosses midnight', () => {
    // 2021-01-01 19:30 UTC == 2021-01-02 01:00 IST
    expect(formatCandleDate(new Date('2021-01-01T19:30:00Z'))).toBe('2021-01-02 01:00')
  })
})
