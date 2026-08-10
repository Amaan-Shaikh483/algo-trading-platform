import { describe, expect, it } from 'vitest'
import { defaultRules, indicatorInstanceId } from '@algo/rule-schema'
import type { Condition, Operand, StrategyRules } from '@algo/rule-schema'
import { IndicatorRuntime } from './indicatorEngine'
import type { IndicatorSpec } from './indicatorEngine'
import { evaluateCondition, evaluateEntrySignal, operandValue } from './ruleEvaluator'
import type { EvalFrame } from './ruleEvaluator'
import type { Candle } from '../brokers/types'

/**
 * Spec §6 step 10 — formal unit tests for the strategy rule evaluator.
 * Locks the semantics that BOTH engines (backtest & live) must share:
 * every operator's exact behavior incl. crosses (+/- equality edges) and
 * warmup/NaN handling (a bar without full data can never produce a signal).
 */

/* ── fixtures ── */

let timeSeq = 0
function candle(over: Partial<Candle> = {}): Candle {
  return { time: new Date(Date.UTC(2026, 6, 24, 4, timeSeq++)), open: 100, high: 101, low: 99, close: 100, volume: 1000, ...over }
}

const price = (field: 'open' | 'high' | 'low' | 'close' | 'volume'): Operand => ({ kind: 'price', field })
const value = (v: number): Operand => ({ kind: 'value', value: v })

function frame(current: Candle, previous?: Candle, runtime = new IndicatorRuntime([])): EvalFrame {
  return { current, previous, runtime }
}

function cond(left: Operand, operator: Condition['operator'], right: Operand): Condition {
  return { id: `c-${Math.random().toString(36).slice(2)}`, left, operator, right }
}

function rulesWith(combinator: 'and' | 'or', conditions: Condition[]): StrategyRules {
  const rules = defaultRules()
  rules.entryConditions = { combinator, conditions }
  return rules
}

/* ── operandValue ── */

describe('operandValue', () => {
  it('resolves constant values at both offsets', () => {
    const f = frame(candle(), candle())
    expect(operandValue(value(42), f, 0)).toBe(42)
    expect(operandValue(value(42), f, 1)).toBe(42)
  })

  it('resolves price fields from current vs previous bar', () => {
    const cur = candle({ close: 101, high: 102 })
    const prev = candle({ close: 99, high: 100 })
    const f = frame(cur, prev)
    expect(operandValue(price('close'), f, 0)).toBe(101)
    expect(operandValue(price('close'), f, 1)).toBe(99)
    expect(operandValue(price('high'), f, 1)).toBe(100)
  })

  it('previous-bar price is NaN on the first bar (no previous candle)', () => {
    const f = frame(candle({ close: 101 }))
    expect(Number.isNaN(operandValue(price('close'), f, 1))).toBe(true)
  })

  it('resolves indicator outputs through the runtime, NaN during warmup', () => {
    const spec: IndicatorSpec = { instanceId: indicatorInstanceId('sma', { period: 3 }), key: 'sma', params: { period: 3 } }
    const runtime = new IndicatorRuntime([spec])
    const sma: Operand = { kind: 'indicator', indicator: 'sma', params: { period: 3 }, output: 'value' }

    runtime.update(candle({ close: 10 }))
    expect(Number.isNaN(operandValue(sma, frame(candle(), undefined, runtime), 0))).toBe(true) // warmup: 1 of 3
    runtime.update(candle({ close: 11 }))
    runtime.update(candle({ close: 12 }))
    expect(operandValue(sma, frame(candle(), candle(), runtime), 0)).toBeCloseTo(11, 10) // (10+11+12)/3
  })
})

/* ── comparison operators ── */

describe('comparison operators', () => {
  const f = () => frame(candle({ close: 100 }), candle({ close: 99 }))

  it('gt / gte boundaries', () => {
    expect(evaluateCondition(cond(price('close'), 'gt', value(99.99)), f()).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'gt', value(100)), f()).passed).toBe(false)
    expect(evaluateCondition(cond(price('close'), 'gte', value(100)), f()).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'gte', value(100.01)), f()).passed).toBe(false)
  })

  it('lt / lte boundaries', () => {
    expect(evaluateCondition(cond(price('close'), 'lt', value(100.01)), f()).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'lt', value(100)), f()).passed).toBe(false)
    expect(evaluateCondition(cond(price('close'), 'lte', value(100)), f()).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'lte', value(99.99)), f()).passed).toBe(false)
  })

  it('equals uses a 1e-9 absolute tolerance', () => {
    expect(evaluateCondition(cond(value(1), 'equals', value(1 + 5e-10)), f()).passed).toBe(true)
    expect(evaluateCondition(cond(value(1), 'equals', value(1 + 1e-8)), f()).passed).toBe(false)
  })

  it('verdict always carries the compared values', () => {
    const v = evaluateCondition(cond(price('close'), 'gt', value(50)), f())
    expect(v.left).toBe(100)
    expect(v.right).toBe(50)
  })

  it('non-finite operands never pass, for every operator', () => {
    const nanLeft = frame(candle({ close: Number.NaN }), candle({ close: 99 }))
    for (const op of ['gt', 'gte', 'lt', 'lte', 'equals', 'crosses_above', 'crosses_below'] as const) {
      expect(evaluateCondition(cond(price('close'), op, value(50)), nanLeft).passed).toBe(false)
    }
  })
})

/* ── crosses_above / crosses_below ── */

describe('crosses', () => {
  it('crosses_above: prev ≤ threshold and current > threshold', () => {
    const f = frame(candle({ close: 101 }), candle({ close: 99 }))
    expect(evaluateCondition(cond(price('close'), 'crosses_above', value(100)), f).passed).toBe(true)
  })

  it('crosses_above treats a previous EQUAL bar as crossed (≤ semantics)', () => {
    const f = frame(candle({ close: 101 }), candle({ close: 100 }))
    expect(evaluateCondition(cond(price('close'), 'crosses_above', value(100)), f).passed).toBe(true)
  })

  it('crosses_above requires current STRICTLY above (current equal is no cross)', () => {
    const f = frame(candle({ close: 100 }), candle({ close: 99 }))
    expect(evaluateCondition(cond(price('close'), 'crosses_above', value(100)), f).passed).toBe(false)
  })

  it('crosses_above fails when already above on the previous bar', () => {
    const f = frame(candle({ close: 102 }), candle({ close: 101 }))
    expect(evaluateCondition(cond(price('close'), 'crosses_above', value(100)), f).passed).toBe(false)
  })

  it('crosses_below: mirror semantics (prev ≥, current strictly <)', () => {
    expect(evaluateCondition(cond(price('close'), 'crosses_below', value(100)), frame(candle({ close: 99 }), candle({ close: 101 }))).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'crosses_below', value(100)), frame(candle({ close: 99 }), candle({ close: 100 }))).passed).toBe(true)
    expect(evaluateCondition(cond(price('close'), 'crosses_below', value(100)), frame(candle({ close: 100 }), candle({ close: 101 }))).passed).toBe(false)
    expect(evaluateCondition(cond(price('close'), 'crosses_below', value(100)), frame(candle({ close: 98 }), candle({ close: 99 }))).passed).toBe(false)
  })

  it('crosses never fire on the first bar (previous values NaN)', () => {
    const f = frame(candle({ close: 101 })) // no previous candle
    expect(evaluateCondition(cond(price('close'), 'crosses_above', value(100)), f).passed).toBe(false)
    expect(evaluateCondition(cond(price('close'), 'crosses_below', value(100)), f).passed).toBe(false)
  })

  it('crosses work end-to-end on a real SMA runtime (signal parity chain)', () => {
    const spec: IndicatorSpec = { instanceId: indicatorInstanceId('sma', { period: 2 }), key: 'sma', params: { period: 2 } }
    const runtime = new IndicatorRuntime([spec])
    const sma: Operand = { kind: 'indicator', indicator: 'sma', params: { period: 2 }, output: 'value' }

    const c1 = candle({ close: 10 })
    runtime.update(c1)
    const c2 = candle({ close: 11 })
    runtime.update(c2) // sma = 10.5, below 10.75
    let f = frame(c2, c1, runtime)
    expect(evaluateCondition(cond(sma, 'crosses_above', value(10.75)), f).passed).toBe(false)

    const c3 = candle({ close: 12 })
    runtime.update(c3) // sma = 11.5, above 10.75 → cross happened on this bar
    f = frame(c3, c2, runtime)
    expect(evaluateCondition(cond(sma, 'crosses_above', value(10.75)), f).passed).toBe(true)
    expect(evaluateCondition(cond(sma, 'crosses_below', value(10.75)), f).passed).toBe(false)

    const c4 = candle({ close: 13 })
    runtime.update(c4) // sma = 12.5, still above — no NEW cross
    f = frame(c4, c3, runtime)
    expect(evaluateCondition(cond(sma, 'crosses_above', value(10.75)), f).passed).toBe(false)
  })
})

/* ── entry signal combinators ── */

describe('evaluateEntrySignal', () => {
  const f = frame(candle({ close: 100 }), candle({ close: 99 }))
  const trueCond = cond(value(2), 'gt', value(1))
  const falseCond = cond(value(1), 'gt', value(2))

  it('empty condition group never yields a signal', () => {
    expect(evaluateEntrySignal(rulesWith('and', []), f)).toBe(false)
    expect(evaluateEntrySignal(rulesWith('or', []), f)).toBe(false)
  })

  it('AND requires every condition', () => {
    expect(evaluateEntrySignal(rulesWith('and', [trueCond, trueCond]), f)).toBe(true)
    expect(evaluateEntrySignal(rulesWith('and', [trueCond, falseCond]), f)).toBe(false)
    expect(evaluateEntrySignal(rulesWith('and', [falseCond, falseCond]), f)).toBe(false)
  })

  it('OR requires any condition', () => {
    expect(evaluateEntrySignal(rulesWith('or', [trueCond, falseCond]), f)).toBe(true)
    expect(evaluateEntrySignal(rulesWith('or', [falseCond, falseCond]), f)).toBe(false)
  })
})
