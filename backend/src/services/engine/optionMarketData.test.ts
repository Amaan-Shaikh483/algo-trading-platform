import { describe, expect, it } from 'vitest'
import { RULE_SCHEMA_VERSION } from '@algo/rule-schema'
import type { StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import type { Candle } from '../brokers/types'
import {
  attachSyntheticOptionChains,
  resolveNominalExpiry,
  strikeForLeg,
} from './optionMarketData'

const leg: StrategyRuleLeg = {
  legNumber: 1,
  condition: 'LONG',
  strikeCriteria: 'ATM',
  strikeType: 'ATM',
  qty: 1,
  position: 'BUY',
  optionType: 'CALL',
  expiry: 'WEEKLY',
  slType: 'SL%',
  slValue: '5',
  tpType: 'TP%',
  tpValue: '10',
  trailSlType: '%',
  trailSlValue: '0',
  priceMovement: '0',
  tradingValue: '0',
  prePunchSl: false,
  active: true,
}

const rules: StrategyRules = {
  version: RULE_SCHEMA_VERSION,
  strategyType: 'option-indicator',
  direction: { side: 'long' },
  entry: { orderType: 'MARKET', productType: 'INTRADAY' },
  entryConditions: { combinator: 'and', conditions: [] },
  longEntryConditions: {
    combinator: 'and',
    conditions: [{ id: 'always', left: { kind: 'price', field: 'close' }, operator: 'gt', right: { kind: 'value', value: 0 } }],
  },
  legs: [leg],
  optionExecution: { minAbsDelta: 0, expiryBufferMinutes: 30, riskFreeRate: 0.06, impliedVolatility: 0.2 },
  exit: { timeSquareOff: { time: '15:10' } },
  risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 1 },
}

function candle(time: string, close = 22_450): Candle {
  return { time: new Date(time), open: close - 10, high: close + 30, low: close - 20, close, volume: 1_000 }
}

describe('option market data', () => {
  it('uses current 2026 exchange expiry weekdays (NSE Tuesday, BSE Thursday)', () => {
    // Monday 10 Aug 2026 at 10:00 IST.
    const at = new Date('2026-08-10T04:30:00.000Z')
    expect(resolveNominalExpiry(at, 'WEEKLY', 'NSE').toISOString()).toBe('2026-08-11T10:00:00.000Z')
    expect(resolveNominalExpiry(at, 'WEEKLY', 'BSE').toISOString()).toBe('2026-08-13T10:00:00.000Z')
  })

  it('maps call and put ITM/OTM strikes in opposite directions', () => {
    expect(strikeForLeg({ ...leg, optionType: 'CALL', strikeType: 'OTM' }, 22_460, 50)).toBe(22_500)
    expect(strikeForLeg({ ...leg, optionType: 'PUT', strikeType: 'OTM' }, 22_460, 50)).toBe(22_400)
    expect(strikeForLeg({ ...leg, optionType: 'CALL', strikeType: 'ITM' }, 22_460, 50)).toBe(22_400)
    expect(strikeForLeg({ ...leg, optionType: 'PUT', strikeType: 'ITM' }, 22_460, 50)).toBe(22_500)
  })

  it('attaches finite premium OHLC and Greeks without mutating input candles', () => {
    const original = candle('2026-08-10T04:30:00.000Z')
    const [enriched] = attachSyntheticOptionChains([original], rules, { exchange: 'NSE', instrument: 'NIFTY 50' })
    expect(original.optionChains).toBeUndefined()
    expect(enriched.optionChains?.size).toBeGreaterThan(0)
    for (const data of enriched.optionChains?.values() ?? []) {
      expect(data.source).toBe('synthetic')
      expect(data.high).toBeGreaterThanOrEqual(data.low)
      expect(data.close).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(data.delta)).toBe(true)
      expect(Number.isFinite(data.gamma)).toBe(true)
      expect(Number.isFinite(data.vega)).toBe(true)
      expect(Number.isFinite(data.theta)).toBe(true)
    }
  })
})
