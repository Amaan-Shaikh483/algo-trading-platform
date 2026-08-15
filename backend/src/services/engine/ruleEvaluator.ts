import { indicatorInstanceId } from '@algo/rule-schema'
import type { Condition, ConditionGroup, Operand, StrategyRules } from '@algo/rule-schema'
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

/** AND/OR over one condition group (spec §3.4 step 2). */
export function evaluateConditionGroup(group: ConditionGroup | undefined, frame: EvalFrame): boolean {
  if (!group || group.conditions.length === 0) return false
  const verdicts = group.conditions.map((c) => evaluateCondition(c, frame).passed)
  return group.combinator === 'and' ? verdicts.every(Boolean) : verdicts.some(Boolean)
}

/**
 * Evaluate a strategy entry signal. When a direction is supplied and the rule
 * tree contains split long/short groups, only that direction's group is used.
 * This is critical: AND-ing a bullish crossover with its bearish inverse (as
 * the old builder's merged compatibility group did) can never fire.
 */
export function evaluateEntrySignal(
  rules: StrategyRules,
  frame: EvalFrame,
  direction?: 'long' | 'short',
): boolean {
  const hasDirectionalGroups =
    (rules.longEntryConditions?.conditions.length ?? 0) > 0 ||
    (rules.shortEntryConditions?.conditions.length ?? 0) > 0
  if (direction && hasDirectionalGroups) {
    return evaluateConditionGroup(
      direction === 'long' ? rules.longEntryConditions : rules.shortEntryConditions,
      frame,
    )
  }
  return evaluateConditionGroup(rules.entryConditions, frame)
}

/** Return all direction-specific signals that pass on this frame. */
export function evaluateDirectionalEntrySignals(
  rules: StrategyRules,
  frame: EvalFrame,
): Array<'long' | 'short'> {
  const hasDirectionalGroups =
    (rules.longEntryConditions?.conditions.length ?? 0) > 0 ||
    (rules.shortEntryConditions?.conditions.length ?? 0) > 0
  if (!hasDirectionalGroups) {
    return evaluateEntrySignal(rules, frame) ? [rules.direction.side] : []
  }
  const allowed = rules.tradeConfiguration?.transactionType ?? 'Both Side'
  const out: Array<'long' | 'short'> = []
  if (allowed !== 'Only Short' && evaluateEntrySignal(rules, frame, 'long')) out.push('long')
  if (allowed !== 'Only Long' && evaluateEntrySignal(rules, frame, 'short')) out.push('short')
  return out
}
