import { describe, expect, it } from 'vitest'
import { RULE_SCHEMA_VERSION } from '@algo/rule-schema'
import type { StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import type { Candle, OptionChainData } from '../brokers/types'
import { runBacktestCore } from './backtestEngine'
import type { BacktestConfig } from './backtestEngine'
import { optionContractId } from './optionMarketData'

const CONFIG: BacktestConfig = {
  initialCapital: 100_000,
  brokerageType: 'flat',
  brokerageValue: 0,
  slippagePercent: 0,
}

const leg: StrategyRuleLeg = {
  legNumber: 1,
  condition: 'LONG',
  strikeCriteria: 'ATM',
  strikeType: 'ATM',
  qty: 10,
  position: 'BUY',
  optionType: 'CALL',
  expiry: 'WEEKLY',
  slType: 'SL%',
  slValue: '20',
  tpType: 'TP%',
  tpValue: '20',
  trailSlType: '%',
  trailSlValue: '0',
  priceMovement: '0',
  tradingValue: '0',
  prePunchSl: false,
  active: true,
}

function optionRules(minAbsDelta = 0.5, expiryBufferMinutes = 30): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    strategyType: 'option-indicator',
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    // This deliberately models the old impossible merged compatibility group.
    // The engine must use longEntryConditions instead.
    entryConditions: {
      combinator: 'and',
      conditions: [
        { id: 'up', left: { kind: 'price', field: 'close' }, operator: 'gt', right: { kind: 'value', value: 0 } },
        { id: 'down', left: { kind: 'price', field: 'close' }, operator: 'lt', right: { kind: 'value', value: 0 } },
      ],
    },
    longEntryConditions: {
      combinator: 'and',
      conditions: [{ id: 'long', left: { kind: 'price', field: 'close' }, operator: 'gt', right: { kind: 'value', value: 0 } }],
    },
    shortEntryConditions: {
      combinator: 'and',
      conditions: [{ id: 'short', left: { kind: 'price', field: 'close' }, operator: 'lt', right: { kind: 'value', value: 0 } }],
    },
    legs: [leg],
    optionExecution: { minAbsDelta, expiryBufferMinutes, riskFreeRate: 0.06, impliedVolatility: 0.2 },
    exit: { timeSquareOff: { time: '15:10' } },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 2 },
  }
}

function withOption(
  iso: string,
  premium: number,
  delta: number,
  expiry: Date,
  range = 1,
): Candle {
  const type = 'CE' as const
  const contractId = optionContractId(type, 22_500, expiry)
  const data: OptionChainData = {
    contractId,
    source: 'market',
    underlying: 22_500,
    strike: 22_500,
    optionType: type,
    expiryType: 'WEEKLY',
    expiry,
    premium,
    open: premium,
    high: premium + range,
    low: Math.max(0, premium - range),
    close: premium,
    volume: 10_000,
    delta,
    gamma: 0.001,
    vega: 5,
    theta: -2,
    impliedVol: 0.2,
    timeToExpiry: Math.max(0, (expiry.getTime() - new Date(iso).getTime()) / 86_400_000),
  }
  return {
    time: new Date(iso),
    open: 22_490,
    high: 22_520,
    low: 22_480,
    close: 22_500,
    volume: 100_000,
    optionChains: new Map([[contractId, data]]),
  }
}

describe('runBacktestCore — option premium execution', () => {
  it('generates an option trade from the matching directional group and fills on premium', () => {
    const expiry = new Date('2026-08-11T10:00:00.000Z')
    const candles = [
      withOption('2026-08-10T04:30:00.000Z', 100, 0.7, expiry),
      withOption('2026-08-10T04:35:00.000Z', 105, 0.72, expiry),
    ]
    const result = runBacktestCore({ rules: optionRules(), candles, config: CONFIG })

    expect(result.summary.totalTrades).toBe(1)
    expect(result.trades[0].entryPrice).toBe(100)
    expect(result.trades[0].exitPrice).toBe(105)
    expect(result.trades[0].optionContract).toMatchObject({ strike: 22_500, optionType: 'CE', source: 'market' })
    expect(result.optionDataMode).toBe('market')
  })

  it('calculates indicator conditions on premium candles rather than underlying candles', () => {
    const expiry = new Date('2026-08-11T10:00:00.000Z')
    const rules = optionRules(0)
    rules.longEntryConditions = {
      combinator: 'and',
      conditions: [
        {
          id: 'premium-cross',
          left: { kind: 'indicator', indicator: 'ema', params: { period: 1 }, output: 'value' },
          operator: 'crosses_above',
          right: { kind: 'indicator', indicator: 'ema', params: { period: 2 }, output: 'value' },
        },
      ],
    }
    // Underlying is flat in every bar; only the option premium can cross.
    const candles = [10, 9, 8, 12, 13].map((premium, i) =>
      withOption(new Date(Date.parse('2026-08-10T04:30:00.000Z') + i * 300_000).toISOString(), premium, 0.7, expiry),
    )
    const result = runBacktestCore({ rules, candles, config: CONFIG })

    expect(result.summary.totalTrades).toBe(1)
    expect(result.trades[0].entryTime).toBe(candles[3].time.toISOString())
    expect(result.trades[0].entryPrice).toBe(12)
  })

  it('skips delta below the configured floor and enters once delta qualifies', () => {
    const expiry = new Date('2026-08-11T10:00:00.000Z')
    const candles = [
      withOption('2026-08-10T04:30:00.000Z', 90, 0.3, expiry),
      withOption('2026-08-10T04:35:00.000Z', 100, 0.7, expiry),
      withOption('2026-08-10T04:40:00.000Z', 102, 0.7, expiry),
    ]
    const result = runBacktestCore({ rules: optionRules(0.5), candles, config: CONFIG })

    expect(result.summary.skippedSignals).toBe(1)
    expect(result.summary.totalTrades).toBe(1)
    expect(result.trades[0].entryTime).toBe(candles[1].time.toISOString())
    expect(result.trades[0].entryPrice).toBe(100)
  })

  it('force-closes at the configured pre-expiry buffer and prevents re-entry', () => {
    const expiry = new Date('2026-08-10T10:00:00.000Z') // 15:30 IST
    const candles = [
      withOption('2026-08-10T09:25:00.000Z', 100, 0.7, expiry), // 14:55 IST; 35m left
      withOption('2026-08-10T09:30:00.000Z', 103, 0.7, expiry), // 15:00 IST; buffer starts
      withOption('2026-08-10T09:35:00.000Z', 105, 0.7, expiry),
    ]
    const result = runBacktestCore({ rules: optionRules(0.5, 30), candles, config: CONFIG })

    expect(result.summary.totalTrades).toBe(1)
    expect(result.trades[0].exitTime).toBe(candles[1].time.toISOString())
    expect(result.trades[0].exitReason).toBe('expiry_squareoff')
    expect(result.summary.skippedSignals).toBeGreaterThanOrEqual(1)
  })
})
