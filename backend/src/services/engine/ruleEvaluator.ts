import { indicatorInstanceId } from '@algo/rule-schema'
import type { Condition, Operand, StrategyRules } from '@algo/rule-schema'
import type { Candle } from '../brokers/types'
import type { IndicatorRuntime } from './indicatorEngine'

/**
 * Rule-condition evaluator (spec §3.4/3.5). Pure function of (rules, indicator
 * values, last-two candles) — the live engine (step 7) calls the SAME code on
 * candle close, which is what guarantees backtest ↔ live signal parity.
 */

export interface EvalFrame {
  current: Candle
  previous: Candle | undefined
  runtime: IndicatorRuntime
}

/** Resolve an operand to a number at offset (0 = current bar, 1 = previous). NaN when unavailable (warmup). */
export function operandValue(op: Operand, frame: EvalFrame, offset: 0 | 1): number {
  if (op.kind === 'value') return op.value
  if (op.kind === 'price') {
    const candle = offset === 0 ? frame.current : frame.previous
    return candle ? candle[op.field] : Number.NaN
  }
  return frame.runtime.value(indicatorInstanceId(op.indicator, op.params), op.output, offset)
}

export interface ConditionVerdict {
  passed: boolean
  left: number
  right: number
}

export function evaluateCondition(condition: Condition, frame: EvalFrame): ConditionVerdict {
  const left = operandValue(condition.left, frame, 0)
  const right = operandValue(condition.right, frame, 0)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return { passed: false, left, right }

  switch (condition.operator) {
    case 'gt':
      return { passed: left > right, left, right }
    case 'gte':
      return { passed: left >= right, left, right }
    case 'lt':
      return { passed: left < right, left, right }
    case 'lte':
      return { passed: left <= right, left, right }
    case 'equals':
      return { passed: Math.abs(left - right) <= 1e-9, left, right }
    case 'crosses_above':
    case 'crosses_below': {
      const prevLeft = operandValue(condition.left, frame, 1)
      const prevRight = operandValue(condition.right, frame, 1)
      if (!Number.isFinite(prevLeft) || !Number.isFinite(prevRight)) return { passed: false, left, right }
      if (condition.operator === 'crosses_above') {
        return { passed: prevLeft <= prevRight && left > right, left, right }
      }
      return { passed: prevLeft >= prevRight && left < right, left, right }
    }
    default:
      return { passed: false, left, right }
  }
}

/** AND/OR over the entry group (spec §3.4 step 2). */
export function evaluateEntrySignal(rules: StrategyRules, frame: EvalFrame): boolean {
  const { combinator, conditions } = rules.entryConditions
  if (conditions.length === 0) return false
  const verdicts = conditions.map((c) => evaluateCondition(c, frame).passed)
  return combinator === 'and' ? verdicts.every(Boolean) : verdicts.some(Boolean)
}
