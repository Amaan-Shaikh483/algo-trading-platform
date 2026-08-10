import { RULE_SCHEMA_VERSION, defaultRules, newConditionId } from '@algo/rule-schema'
import type {
  Condition,
  OrderType,
  ProductType,
  Segment,
  StrategyRules,
  Timeframe,
} from '@algo/rule-schema'
import type { InstrumentHit } from '../../lib/instrumentApi'
import type { StrategyRowView } from '../../lib/strategyApi'

/** UI state for step 3 (numbers kept as strings for input control). */
export interface ExitUiState {
  slEnabled: boolean
  slType: 'points' | 'percent' | 'atr'
  slValue: string
  slAtrPeriod: string
  targetEnabled: boolean
  targetType: 'points' | 'percent' | 'rr_multiple'
  targetValue: string
  trailingEnabled: boolean
  trailingType: 'points' | 'percent'
  trailingValue: string
  timeSqEnabled: boolean
  timeSq: string
  maxHoldEnabled: boolean
  maxHoldBars: string
}

export interface RiskUiState {
  quantity: string
  capitalAllocPercent: string
  maxPositions: string
  maxTradesPerDay: string
}

export interface BuilderState {
  id?: string
  name: string
  description: string
  instrument: InstrumentHit | null
  segment: Segment
  timeframe: Timeframe
  direction: 'long' | 'short'
  orderType: OrderType
  productType: ProductType
  combinator: 'and' | 'or'
  entryConditions: Condition[]
  exit: ExitUiState
  risk: RiskUiState
}

export function initialBuilderState(): BuilderState {
  const defaults = defaultRules()
  return {
    name: '',
    description: '',
    instrument: null,
    segment: 'equity',
    timeframe: '5m',
    direction: defaults.direction.side,
    orderType: defaults.entry.orderType,
    productType: defaults.entry.productType,
    combinator: 'and',
    entryConditions: [],
    exit: {
      slEnabled: true,
      slType: 'points',
      slValue: '0',
      slAtrPeriod: '14',
      targetEnabled: true,
      targetType: 'rr_multiple',
      targetValue: '2',
      trailingEnabled: false,
      trailingType: 'points',
      trailingValue: '0',
      timeSqEnabled: true,
      timeSq: '15:20',
      maxHoldEnabled: false,
      maxHoldBars: '30',
    },
    risk: { quantity: '1', capitalAllocPercent: '', maxPositions: '1', maxTradesPerDay: '5' },
  }
}

export function newCondition(): Condition {
  return {
    id: newConditionId(),
    left: { kind: 'indicator', indicator: 'ema', params: { period: 9 }, output: 'value' },
    operator: 'crosses_above',
    right: { kind: 'indicator', indicator: 'ema', params: { period: 21 }, output: 'value' },
  }
}

const num = (s: string): number => Number(s)

/** Assemble the persistable rule tree (input to validateStrategyRules + the engines). */
export function toRules(state: BuilderState): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: state.direction },
    entry: { orderType: state.orderType, productType: state.productType },
    entryConditions: { combinator: state.combinator, conditions: state.entryConditions },
    exit: {
      ...(state.exit.slEnabled
        ? {
            stopLoss: {
              type: state.exit.slType,
              value: num(state.exit.slValue),
              ...(state.exit.slType === 'atr' ? { atrPeriod: num(state.exit.slAtrPeriod) } : {}),
            },
          }
        : {}),
      ...(state.exit.targetEnabled ? { target: { type: state.exit.targetType, value: num(state.exit.targetValue) } } : {}),
      ...(state.exit.trailingEnabled
        ? { trailingStopLoss: { type: state.exit.trailingType, value: num(state.exit.trailingValue) } }
        : {}),
      ...(state.exit.timeSqEnabled ? { timeSquareOff: { time: state.exit.timeSq } } : {}),
      ...(state.exit.maxHoldEnabled ? { maxHoldingBars: num(state.exit.maxHoldBars) } : {}),
    },
    risk: {
      quantity: num(state.risk.quantity),
      ...(state.risk.capitalAllocPercent.trim() ? { capitalAllocationPercent: num(state.risk.capitalAllocPercent) } : {}),
      maxConcurrentPositions: num(state.risk.maxPositions),
      maxTradesPerDay: num(state.risk.maxTradesPerDay),
    },
  }
}

/** Hydrate the wizard from a saved strategy (edit mode). */
export function fromStrategyRow(row: StrategyRowView): BuilderState {
  const r = row.rules
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    instrument: {
      token: row.symbol_token,
      symbol: row.instrument,
      name: null,
      exchange: row.exchange,
      segment: row.segment,
      lotsize: null,
      tick_size: null,
      expiry: null,
      strike: null,
    },
    segment: row.segment,
    timeframe: row.timeframe as Timeframe,
    direction: r.direction.side,
    orderType: r.entry.orderType,
    productType: r.entry.productType,
    combinator: r.entryConditions.combinator,
    entryConditions: r.entryConditions.conditions,
    exit: {
      slEnabled: r.exit.stopLoss != null,
      slType: r.exit.stopLoss?.type ?? 'points',
      slValue: String(r.exit.stopLoss?.value ?? 0),
      slAtrPeriod: String(r.exit.stopLoss?.atrPeriod ?? 14),
      targetEnabled: r.exit.target != null,
      targetType: r.exit.target?.type ?? 'rr_multiple',
      targetValue: String(r.exit.target?.value ?? 2),
      trailingEnabled: r.exit.trailingStopLoss != null,
      trailingType: r.exit.trailingStopLoss?.type ?? 'points',
      trailingValue: String(r.exit.trailingStopLoss?.value ?? 0),
      timeSqEnabled: r.exit.timeSquareOff != null,
      timeSq: r.exit.timeSquareOff?.time ?? '15:20',
      maxHoldEnabled: r.exit.maxHoldingBars != null,
      maxHoldBars: String(r.exit.maxHoldingBars ?? 30),
    },
    risk: {
      quantity: String(r.risk.quantity),
      capitalAllocPercent: r.risk.capitalAllocationPercent != null ? String(r.risk.capitalAllocationPercent) : '',
      maxPositions: String(r.risk.maxConcurrentPositions),
      maxTradesPerDay: String(r.risk.maxTradesPerDay),
    },
  }
}

/** Per-step gating for the wizard's Next button. */
export function stepErrors(state: BuilderState, step: number): string[] {
  const errors: string[] = []
  if (step === 0) {
    if (!state.name.trim()) errors.push('Strategy name is required')
    if (!state.instrument) errors.push('Choose an instrument from the search')
  }
  if (step === 1 && state.entryConditions.length === 0) errors.push('Add at least one entry condition')
  if (step === 2) {
    const ex = state.exit
    const anyExit = ex.slEnabled || ex.targetEnabled || ex.trailingEnabled || ex.timeSqEnabled || ex.maxHoldEnabled
    if (!anyExit) errors.push('Configure at least one exit rule')
    if (ex.timeSqEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ex.timeSq)) errors.push('Time square-off must be HH:mm (24h IST)')
  }
  if (step === 3) {
    if (!(num(state.risk.quantity) >= 1)) errors.push('Quantity must be ≥ 1')
    if (!(num(state.risk.maxPositions) >= 1)) errors.push('Max concurrent positions must be ≥ 1')
    if (!(num(state.risk.maxTradesPerDay) >= 1)) errors.push('Max trades/day must be ≥ 1')
    if (state.risk.capitalAllocPercent.trim()) {
      const v = num(state.risk.capitalAllocPercent)
      if (!(v > 0 && v <= 100)) errors.push('Capital allocation must be 0 < % ≤ 100')
    }
  }
  return errors
}
