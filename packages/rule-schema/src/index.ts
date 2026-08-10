/**
 * @algo/rule-schema — the versioned strategy rule-tree (spec §3.4).
 *
 * SINGLE SOURCE OF TRUTH for the JSON the builder produces, the backtest
 * engine replays (step 6) and the live engine evaluates (step 7) — indicator
 * math must be identical across all three, so all consume this package.
 *
 * Versioning: `RULE_SCHEMA_VERSION` bumps on any breaking change; saved
 * strategies carry their schema version and future migrations upgrade them.
 */

export const RULE_SCHEMA_VERSION = 1 as const

// ── Enums ────────────────────────────────────────────────────────────────────

export const TIMEFRAMES = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '1D'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const SEGMENTS = ['equity', 'futures', 'options'] as const
export type Segment = (typeof SEGMENTS)[number]

export const ORDER_TYPES = ['MARKET', 'LIMIT'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export const PRODUCT_TYPES = ['INTRADAY', 'DELIVERY', 'MARGIN'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const OPERATORS = [
  { key: 'gt', label: '>', crosses: false },
  { key: 'gte', label: '≥', crosses: false },
  { key: 'lt', label: '<', crosses: false },
  { key: 'lte', label: '≤', crosses: false },
  { key: 'crosses_above', label: 'crosses above', crosses: true },
  { key: 'crosses_below', label: 'crosses below', crosses: true },
  { key: 'equals', label: '=', crosses: false },
] as const
export type Operator = (typeof OPERATORS)[number]['key']

// ── Indicator registry (spec §3.4 supported set) ────────────────────────────

export interface IndicatorParamDef {
  key: string
  label: string
  default: number
  min?: number
  max?: number
  step?: number
}

export interface IndicatorDef {
  key: IndicatorKey
  label: string
  /** `technicalindicators` package class used by engines (documented for step 6/7 impl). */
  engineSource: string
  params: IndicatorParamDef[]
  /** Selectable output lines in the builder. */
  outputs: { key: string; label: string }[]
  /** True for 0/1 style pattern signals (bullish engulfing, doji…). */
  isSignal?: boolean
}

export type IndicatorKey =
  | 'sma'
  | 'ema'
  | 'wma'
  | 'rsi'
  | 'stochastic'
  | 'macd'
  | 'bollinger'
  | 'atr'
  | 'supertrend'
  | 'adx'
  | 'vwap'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'doji'

export const INDICATORS: Record<IndicatorKey, IndicatorDef> = {
  sma: {
    key: 'sma', label: 'SMA (Simple Moving Average)', engineSource: 'SMA',
    params: [{ key: 'period', label: 'Period', default: 20, min: 1, max: 500 }],
    outputs: [{ key: 'value', label: 'SMA value' }],
  },
  ema: {
    key: 'ema', label: 'EMA (Exponential Moving Average)', engineSource: 'EMA',
    params: [{ key: 'period', label: 'Period', default: 20, min: 1, max: 500 }],
    outputs: [{ key: 'value', label: 'EMA value' }],
  },
  wma: {
    key: 'wma', label: 'WMA (Weighted Moving Average)', engineSource: 'WMA',
    params: [{ key: 'period', label: 'Period', default: 9, min: 1, max: 500 }],
    outputs: [{ key: 'value', label: 'WMA value' }],
  },
  rsi: {
    key: 'rsi', label: 'RSI (Relative Strength Index)', engineSource: 'RSI',
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 100 }],
    outputs: [{ key: 'value', label: 'RSI value' }],
  },
  stochastic: {
    key: 'stochastic', label: 'Stochastic', engineSource: 'Stochastic',
    params: [
      { key: 'period', label: '%K period', default: 14, min: 2, max: 100 },
      { key: 'signalPeriod', label: '%D period', default: 3, min: 1, max: 50 },
    ],
    outputs: [
      { key: 'k', label: '%K' },
      { key: 'd', label: '%D' },
    ],
  },
  macd: {
    key: 'macd', label: 'MACD', engineSource: 'MACD',
    params: [
      { key: 'fastPeriod', label: 'Fast period', default: 12, min: 1, max: 200 },
      { key: 'slowPeriod', label: 'Slow period', default: 26, min: 2, max: 500 },
      { key: 'signalPeriod', label: 'Signal period', default: 9, min: 1, max: 100 },
    ],
    outputs: [
      { key: 'macd', label: 'MACD line' },
      { key: 'signal', label: 'Signal line' },
      { key: 'histogram', label: 'Histogram' },
    ],
  },
  bollinger: {
    key: 'bollinger', label: 'Bollinger Bands', engineSource: 'BollingerBands',
    params: [
      { key: 'period', label: 'Period', default: 20, min: 2, max: 200 },
      { key: 'stdDev', label: 'Std. deviations', default: 2, min: 0.5, max: 5, step: 0.1 },
    ],
    outputs: [
      { key: 'upper', label: 'Upper band' },
      { key: 'middle', label: 'Middle band' },
      { key: 'lower', label: 'Lower band' },
      { key: 'pb', label: '%B' },
    ],
  },
  atr: {
    key: 'atr', label: 'ATR (Average True Range)', engineSource: 'ATR',
    params: [{ key: 'period', label: 'Period', default: 14, min: 1, max: 100 }],
    outputs: [{ key: 'value', label: 'ATR value' }],
  },
  supertrend: {
    key: 'supertrend', label: 'Supertrend', engineSource: 'custom (ATR-based)',
    params: [
      { key: 'period', label: 'ATR period', default: 10, min: 1, max: 100 },
      { key: 'multiplier', label: 'Multiplier', default: 3, min: 0.5, max: 10, step: 0.5 },
    ],
    outputs: [
      { key: 'value', label: 'Supertrend line' },
      { key: 'direction', label: 'Direction (+1 up / −1 down)' },
    ],
  },
  adx: {
    key: 'adx', label: 'ADX (Average Directional Index)', engineSource: 'ADX',
    params: [{ key: 'period', label: 'Period', default: 14, min: 2, max: 100 }],
    outputs: [
      { key: 'adx', label: 'ADX' },
      { key: 'pdi', label: '+DI' },
      { key: 'mdi', label: '−DI' },
    ],
  },
  vwap: {
    key: 'vwap', label: 'VWAP (intraday, session-anchored)', engineSource: 'custom (cumulative)',
    params: [],
    outputs: [{ key: 'value', label: 'VWAP value' }],
  },
  bullish_engulfing: {
    key: 'bullish_engulfing', label: 'Bullish Engulfing (candle pattern)', engineSource: 'bullishengulfingpattern',
    params: [],
    outputs: [{ key: 'value', label: 'Signal (1 = detected)' }],
    isSignal: true,
  },
  bearish_engulfing: {
    key: 'bearish_engulfing', label: 'Bearish Engulfing (candle pattern)', engineSource: 'bearishengulfingpattern',
    params: [],
    outputs: [{ key: 'value', label: 'Signal (1 = detected)' }],
    isSignal: true,
  },
  doji: {
    key: 'doji', label: 'Doji (candle pattern)', engineSource: 'doji',
    params: [],
    outputs: [{ key: 'value', label: 'Signal (1 = detected)' }],
    isSignal: true,
  },
}

export const INDICATOR_KEYS = Object.keys(INDICATORS) as IndicatorKey[]

// ── Operands & conditions ────────────────────────────────────────────────────

export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume'

export interface IndicatorOperand {
  kind: 'indicator'
  indicator: IndicatorKey
  params: Record<string, number>
  output: string
}
export interface ValueOperand {
  kind: 'value'
  value: number
}
export interface PriceOperand {
  kind: 'price'
  field: PriceField
}
export type Operand = IndicatorOperand | ValueOperand | PriceOperand

export interface Condition {
  id: string
  left: Operand
  operator: Operator
  right: Operand
}

export interface ConditionGroup {
  combinator: 'and' | 'or'
  conditions: Condition[]
}

// ── Exit & risk rules ────────────────────────────────────────────────────────

export interface StopLossRule {
  type: 'points' | 'percent' | 'atr'
  /** points | % | ATR multiple respectively */
  value: number
  atrPeriod?: number
}
export interface TargetRule {
  type: 'points' | 'percent' | 'rr_multiple'
  value: number
}
export interface TrailingSlRule {
  type: 'points' | 'percent'
  value: number
}
export interface ExitRules {
  stopLoss?: StopLossRule
  target?: TargetRule
  trailingStopLoss?: TrailingSlRule
  /** Forced square-off at an IST time, e.g. "15:20" (spec §3.4 step 3). */
  timeSquareOff?: { time: string }
  /** Force exit after N candles regardless of SL/target. */
  maxHoldingBars?: number
}

export interface RiskRules {
  quantity: number
  /** % of account capital this strategy may deploy per position. */
  capitalAllocationPercent?: number
  maxConcurrentPositions: number
  maxTradesPerDay: number
}

export interface TradeDirection {
  /** 'long' = BUY entry / SELL exit; 'short' = SELL entry / BUY exit. */
  side: 'long' | 'short'
}

export interface StrategyRules {
  version: typeof RULE_SCHEMA_VERSION
  direction: TradeDirection
  entry: { orderType: OrderType; productType: ProductType }
  entryConditions: ConditionGroup
  exit: ExitRules
  risk: RiskRules
}

// ── Defaults for the builder ─────────────────────────────────────────────────

export function defaultRules(): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: { combinator: 'and', conditions: [] },
    exit: {
      stopLoss: { type: 'points', value: 0 },
      target: { type: 'rr_multiple', value: 2 },
      timeSquareOff: { time: '15:20' },
    },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 5 },
  }
}

let conditionCounter = 0
export function newConditionId(): string {
  conditionCounter = (conditionCounter + 1) % 100000
  return `c_${Date.now().toString(36)}_${conditionCounter}`
}

/** Deterministic id for an indicator+params combo — dedupes runtime instances across conditions. */
export function indicatorInstanceId(key: string, params: Record<string, number>): string {
  const stable = Object.keys(params)
    .sort()
    .map((k) => `${k}:${params[k]}`)
    .join(',')
  return `${key}|${stable}`
}

export function defaultParams(indicator: IndicatorKey): Record<string, number> {
  return Object.fromEntries(INDICATORS[indicator].params.map((p) => [p.key, p.default]))
}

// ── Validation ───────────────────────────────────────────────────────────────

const OPERATOR_KEYS: readonly string[] = OPERATORS.map((o) => o.key)

function validateOperand(op: unknown, path: string, errors: string[], allowValue: boolean): void {
  const o = op as Operand
  if (!o || typeof o !== 'object' || typeof (o as { kind?: unknown }).kind !== 'string') {
    errors.push(`${path}: operand is missing or malformed`)
    return
  }
  if (o.kind === 'value') {
    if (!allowValue) errors.push(`${path}: a fixed value is only allowed on the right-hand side`)
    const v = (o as ValueOperand).value
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${path}: value must be a finite number`)
    return
  }
  if (o.kind === 'price') {
    if (!['open', 'high', 'low', 'close', 'volume'].includes((o as PriceOperand).field)) {
      errors.push(`${path}: invalid price field`)
    }
    return
  }
  if (o.kind === 'indicator') {
    const ind = (o as IndicatorOperand).indicator
    const def = INDICATORS[ind]
    if (!def) {
      errors.push(`${path}: unknown indicator '${String(ind)}'`)
      return
    }
    const params = (o as IndicatorOperand).params ?? {}
    for (const p of def.params) {
      const v = params[p.key]
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${path}: ${def.label} param '${p.label}' must be a number`)
      } else {
        if (p.min != null && v < p.min) errors.push(`${path}: ${def.label} '${p.label}' must be ≥ ${p.min}`)
        if (p.max != null && v > p.max) errors.push(`${path}: ${def.label} '${p.label}' must be ≤ ${p.max}`)
      }
    }
    const output = (o as IndicatorOperand).output
    if (!def.outputs.some((out) => out.key === output)) {
      errors.push(`${path}: invalid output '${String(output)}' for ${def.label}`)
    }
    return
  }
  errors.push(`${path}: unknown operand kind '${String((o as { kind: unknown }).kind)}'`)
}

export function validateStrategyRules(rules: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const r = rules as StrategyRules
  if (!r || typeof r !== 'object') return { valid: false, errors: ['rules missing'] }

  if (r.version !== RULE_SCHEMA_VERSION) errors.push(`unsupported rule schema version: ${String(r.version)}`)
  if (r.direction?.side !== 'long' && r.direction?.side !== 'short') {
    errors.push("direction.side must be 'long' or 'short'")
  }
  if (!ORDER_TYPES.includes(r.entry?.orderType)) errors.push(`entry.orderType must be one of ${ORDER_TYPES.join('/')}`)
  if (!PRODUCT_TYPES.includes(r.entry?.productType)) errors.push(`entry.productType must be one of ${PRODUCT_TYPES.join('/')}`)

  const group = r.entryConditions
  if (!group || (group.combinator !== 'and' && group.combinator !== 'or')) {
    errors.push("entryConditions.combinator must be 'and' or 'or'")
  }
  const conditions = group?.conditions ?? []
  if (!Array.isArray(conditions) || conditions.length === 0) {
    errors.push('at least one entry condition is required')
  }
  conditions.forEach((c, i) => {
    const path = `condition ${i + 1}`
    if (!OPERATOR_KEYS.includes(c?.operator)) errors.push(`${path}: invalid operator '${String(c?.operator)}'`)
    validateOperand(c?.left, `${path} (left)`, errors, false)
    validateOperand(c?.right, `${path} (right)`, errors, true)
  })

  const ex = r.exit ?? {}
  if (ex.stopLoss) {
    if (!['points', 'percent', 'atr'].includes(ex.stopLoss.type)) errors.push('exit.stopLoss.type invalid')
    if (!(ex.stopLoss.value > 0)) errors.push('exit.stopLoss.value must be > 0')
    if (ex.stopLoss.type === 'percent' && ex.stopLoss.value > 100) errors.push('exit.stopLoss percent must be ≤ 100')
    if (ex.stopLoss.type === 'atr' && ex.stopLoss.atrPeriod != null && ex.stopLoss.atrPeriod < 1) {
      errors.push('exit.stopLoss.atrPeriod must be ≥ 1')
    }
  }
  if (ex.target) {
    if (!['points', 'percent', 'rr_multiple'].includes(ex.target.type)) errors.push('exit.target.type invalid')
    if (!(ex.target.value > 0)) errors.push('exit.target.value must be > 0')
    if (ex.target.type === 'rr_multiple' && !ex.stopLoss) {
      errors.push('exit.target (risk × reward) requires a stop loss to measure risk against')
    }
  }
  if (ex.trailingStopLoss) {
    if (!['points', 'percent'].includes(ex.trailingStopLoss.type)) errors.push('exit.trailingStopLoss.type invalid')
    if (!(ex.trailingStopLoss.value > 0)) errors.push('exit.trailingStopLoss.value must be > 0')
  }
  if (ex.timeSquareOff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ex.timeSquareOff.time)) {
    errors.push('exit.timeSquareOff.time must be HH:mm (24h, IST)')
  }
  if (ex.maxHoldingBars != null && (!Number.isInteger(ex.maxHoldingBars) || ex.maxHoldingBars < 1)) {
    errors.push('exit.maxHoldingBars must be a positive integer')
  }
  if (!ex.stopLoss && !ex.target && !ex.timeSquareOff && !ex.maxHoldingBars && !ex.trailingStopLoss) {
    errors.push('at least one exit rule is required (stop loss, target, trailing SL, time square-off, or max holding)')
  }

  const rk = r.risk ?? ({} as RiskRules)
  if (!Number.isInteger(rk.quantity) || rk.quantity < 1) errors.push('risk.quantity must be a positive integer')
  if (!Number.isInteger(rk.maxConcurrentPositions) || rk.maxConcurrentPositions < 1) {
    errors.push('risk.maxConcurrentPositions must be a positive integer')
  }
  if (!Number.isInteger(rk.maxTradesPerDay) || rk.maxTradesPerDay < 1) {
    errors.push('risk.maxTradesPerDay must be a positive integer')
  }
  if (rk.capitalAllocationPercent != null && (rk.capitalAllocationPercent <= 0 || rk.capitalAllocationPercent > 100)) {
    errors.push('risk.capitalAllocationPercent must be between 0 and 100')
  }

  return { valid: errors.length === 0, errors }
}

// ── Human-readable serialization (review screen, engine logs) ───────────────

export function describeOperand(op: Operand): string {
  if (op.kind === 'value') return String(op.value)
  if (op.kind === 'price') return op.field === 'volume' ? 'Volume' : op.field[0].toUpperCase() + op.field.slice(1)
  const def = INDICATORS[op.indicator]
  const params = def.params.map((p) => op.params[p.key] ?? p.default).join('/')
  const out = def.outputs.find((o) => o.key === op.output)?.label ?? op.output
  return `${def.label.split(' (')[0]}(${params}) ${def.outputs.length > 1 ? out : ''}`.trim()
}

export function describeCondition(c: Condition): { left: string; operator: string; right: string } {
  const opDef = OPERATORS.find((o) => o.key === c.operator)
  return {
    left: describeOperand(c.left),
    operator: opDef?.label ?? c.operator,
    right: describeOperand(c.right),
  }
}

export function operatorLabel(op: Operator): string {
  return OPERATORS.find((o) => o.key === op)?.label ?? op
}

export function summarizeRules(r: StrategyRules): string[] {
  const lines: string[] = []
  lines.push(`Direction: ${r.direction.side.toUpperCase()} · Order: ${r.entry.orderType} · Product: ${r.entry.productType}`)
  const comb = r.entryConditions.combinator.toUpperCase()
  r.entryConditions.conditions.forEach((c, i) => {
    const d = describeCondition(c)
    lines.push(`Entry ${i + 1}${r.entryConditions.conditions.length > 1 ? ` (${comb})` : ''}: ${d.left} ${d.operator} ${d.right}`)
  })
  const ex = r.exit
  if (ex.stopLoss) lines.push(`Stop loss: ${ex.stopLoss.value} ${ex.stopLoss.type === 'percent' ? '%' : ex.stopLoss.type === 'atr' ? '× ATR' : 'pts'}`)
  if (ex.target) lines.push(`Target: ${ex.target.value} ${ex.target.type === 'percent' ? '%' : ex.target.type === 'rr_multiple' ? '× risk (R:R)' : 'pts'}`)
  if (ex.trailingStopLoss) lines.push(`Trailing SL: ${ex.trailingStopLoss.value} ${ex.trailingStopLoss.type === 'percent' ? '%' : 'pts'}`)
  if (ex.timeSquareOff) lines.push(`Time square-off: ${ex.timeSquareOff.time} IST`)
  if (ex.maxHoldingBars) lines.push(`Max holding: ${ex.maxHoldingBars} candles`)
  lines.push(`Qty: ${r.risk.quantity} · Max positions: ${r.risk.maxConcurrentPositions} · Max trades/day: ${r.risk.maxTradesPerDay}${r.risk.capitalAllocationPercent ? ` · Capital: ${r.risk.capitalAllocationPercent}%` : ''}`)
  return lines
}
