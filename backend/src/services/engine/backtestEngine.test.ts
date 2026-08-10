import { describe, expect, it } from 'vitest'
import { RULE_SCHEMA_VERSION } from '@algo/rule-schema'
import type { StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import type { Candle } from '../brokers/types'
import { runBacktestCore } from './backtestEngine'
import type { BacktestConfig } from './backtestEngine'

/**
 * Locks time-triggered leg execution in the backtest engine: option-time legs
 * must open a position once per IST day at their entry time, sized by the leg,
 * and respect the "one position at a time" model.
 */

const CONFIG: BacktestConfig = { initialCapital: 100000, brokerageType: 'flat', brokerageValue: 20, slippagePercent: 0 }

/** Build intraday candles (time = bar OPEN, IST) stepping by `stepMinutes`. */
function intradayCandles(days: number, startIstMin: number, endIstMin: number, stepMinutes: number, priceStep = 0): Candle[] {
  const out: Candle[] = []
  // IST is UTC+5:30, so IST 00:00 on a given date == that UTC date minus 5.5h.
  const IST_UTC_OFFSET_MS = 5.5 * 3600 * 1000
  let price = 100
  for (let d = 0; d < days; d++) {
    for (let min = startIstMin; min <= endIstMin; min += stepMinutes) {
      const istDayStartUtc = Date.UTC(2026, 6, 20 + d) - IST_UTC_OFFSET_MS
      const open = min * 60000
      const high = price + 1
      const low = price - 1
      const close = price + 0.5
      out.push({
        time: new Date(istDayStartUtc + open),
        open: price,
        high,
        low,
        close,
        volume: 1000,
      })
      price += priceStep
    }
  }
  return out
}

function timeLeg(legNumber: number, entryTime: string, position: 'BUY' | 'SELL', qty: number): StrategyRuleLeg {
  return {
    legNumber,
    condition: position === 'BUY' ? 'LONG' : 'SHORT',
    entryTime,
    strikeCriteria: 'ATM',
    strikeType: 'ATM',
    qty,
    position,
    optionType: 'CALL',
    expiry: 'WEEKLY',
    slType: 'SL%',
    slValue: '5',
    tpType: 'TP%',
    tpValue: '10',
    trailSlType: '%',
    trailSlValue: '2',
    priceMovement: '0',
    tradingValue: '0',
    prePunchSl: false,
    active: true,
  }
}

function timeRules(legs: StrategyRuleLeg[]): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: { combinator: 'and', conditions: [] },
    legs,
    exit: { stopLoss: { type: 'points', value: 5 }, target: { type: 'rr_multiple', value: 2 }, timeSquareOff: { time: '15:10' } },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 5 },
  }
}

describe('runBacktestCore — time-triggered legs', () => {
  it('opens one position per IST day when a leg entry time is reached', () => {
    // 2 days, 09:15 → 15:10 IST, 5m bars. Leg fires at 09:25 IST each day; the
    // 15:10 time-square-off closes the daily position so the next day can fire.
    const candles = intradayCandles(2, 9 * 60 + 15, 15 * 60 + 10, 5)
    const rules = timeRules([timeLeg(1, '09:25', 'BUY', 3)])
    const result = runBacktestCore({ rules, candles, config: CONFIG })

    expect(result.summary.totalTrades).toBe(2)
    for (const t of result.trades) {
      expect(t.side).toBe('LONG')
      expect(t.quantity).toBe(3)
    }
  })

  it('respects a SELL leg mapping to SHORT', () => {
    const candles = intradayCandles(1, 9 * 60 + 15, 10 * 60, 5)
    const rules = timeRules([timeLeg(1, '09:25', 'SELL', 2)])
    const result = runBacktestCore({ rules, candles, config: CONFIG })
    expect(result.summary.totalTrades).toBe(1)
    expect(result.trades[0].side).toBe('SHORT')
    expect(result.trades[0].quantity).toBe(2)
  })

  it('does not fire a leg twice on the same day even after an intraday close', () => {
    // Falling prices close each position via stop loss mid-day; the fired-set
    // must prevent a second entry on the same IST day for the same leg.
    const candles = intradayCandles(2, 9 * 60 + 15, 11 * 60, 5, -2)
    const rules = timeRules([timeLeg(1, '09:25', 'BUY', 1)])
    const result = runBacktestCore({ rules, candles, config: CONFIG })
    // Exactly one entry per day (2 days) — not one per bar.
    expect(result.summary.totalTrades).toBe(2)
  })
})
