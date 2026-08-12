import { describe, expect, it } from 'vitest'
import { RULE_SCHEMA_VERSION, validateStrategyRules } from '@algo/rule-schema'
import type { StrategyRules } from '@algo/rule-schema'

/**
 * Locks the payload the builder now emits after mapping Exit Loss (INR) /
 * per-leg Stop Loss into exit.stopLoss — the previous default of
 * `{ type: 'points', value: 0 }` used to fail with
 * `exit.stopLoss.value must be > 0` even when the user had typed 1000 / 5.
 */

function base(over: Partial<StrategyRules> = {}): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: {
      combinator: 'and',
      conditions: [
        {
          id: 'c1',
          left: { kind: 'indicator', indicator: 'ema', params: { period: 9 }, output: 'value' },
          operator: 'crosses_above',
          right: { kind: 'indicator', indicator: 'ema', params: { period: 21 }, output: 'value' },
        },
      ],
    },
    exit: { timeSquareOff: { time: '15:10' } },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 5 },
    ...over,
  }
}

describe('validateStrategyRules — exit.stopLoss mapping', () => {
  it('accepts Exit Loss (INR) = 1000 mapped onto exit.stopLoss.value', () => {
    const result = validateStrategyRules(
      base({
        exit: {
          stopLoss: { type: 'points', value: 1000 },
          overallLossAmount: 1000,
          timeSquareOff: { time: '15:10' },
        },
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('accepts a string "1000" (HTML number input) as a positive stop-loss', () => {
    const result = validateStrategyRules(
      base({
        exit: {
          stopLoss: { type: 'points', value: '1000' as unknown as number },
          timeSquareOff: { time: '15:10' },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts a per-leg SL% of 5 mapped onto exit.stopLoss', () => {
    const result = validateStrategyRules(
      base({
        legs: [
          {
            legNumber: 1,
            condition: 'LONG',
            entryTime: '09:20',
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
            trailSlValue: '2',
            priceMovement: '0',
            tradingValue: '0',
            prePunchSl: false,
            active: true,
          },
        ],
        exit: {
          stopLoss: { type: 'percent', value: 5 },
          target: { type: 'percent', value: 10 },
          timeSquareOff: { time: '15:10' },
        },
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('does not fail when a leftover stopLoss.value of 0 is present (treat as unset)', () => {
    const result = validateStrategyRules(
      base({
        exit: {
          stopLoss: { type: 'points', value: 0 },
          timeSquareOff: { time: '15:10' },
        },
      }),
    )
    expect(result.errors).not.toContain('exit.stopLoss.value must be > 0')
    expect(result.valid).toBe(true)
  })

  it('still rejects a truly negative stop-loss', () => {
    const result = validateStrategyRules(
      base({
        exit: { stopLoss: { type: 'points', value: -1000 }, timeSquareOff: { time: '15:10' } },
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('exit.stopLoss.value must be > 0')
  })
})
