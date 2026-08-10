import { RULE_SCHEMA_VERSION, defaultRules, newConditionId } from '@algo/rule-schema'
import type {
  Condition,
  ConditionGroup,
  OrderType,
  ProductType,
  Segment,
  StrategyRuleLeg,
  StrategyRules,
  Timeframe,
} from '@algo/rule-schema'
import type { InstrumentHit } from '../../lib/instrumentApi'
import type { StrategyRowView } from '../../lib/strategyApi'

// ── Strategy Type ────────────────────────────────────────────────────────────

export type StrategyType = 'stocks-futures' | 'option-indicator' | 'option-time'

export const STRATEGY_TYPE_OPTIONS: { value: StrategyType; label: string }[] = [
  { value: 'option-time', label: 'Option Trading-Time Based' },
  { value: 'option-indicator', label: 'Option Trading-Indicator Based' },
  { value: 'stocks-futures', label: 'Stocks & Futures -Indicator Based' },
]

// ── Stocks & Futures types ───────────────────────────────────────────────────

export type OrderTypeNew = 'MIS' | 'CNC' | 'BTST'
export type TransactionType = 'Both Side' | 'Only Long' | 'Only Short'
export type ChartType = 'Candle' | 'Heikin Ashi'
export type ProfitTrailing = 'No Trailing' | 'Lock Fix' | 'Trail' | 'Lock & Trail'

export const ORDER_TYPE_OPTIONS: { value: OrderTypeNew; label: string; desc: string }[] = [
  { value: 'MIS', label: 'MIS', desc: 'Intraday' },
  { value: 'CNC', label: 'CNC', desc: 'Delivery' },
  { value: 'BTST', label: 'BTST', desc: 'Buy Today Sell Tomorrow' },
]

export const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: 'Both Side', label: 'Both Side' },
  { value: 'Only Long', label: 'Only Long' },
  { value: 'Only Short', label: 'Only Short' },
]

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'Candle', label: 'Candle' },
  { value: 'Heikin Ashi', label: 'Heikin Ashi' },
]

export const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: '1m', label: '1 min' },
  { value: '3m', label: '3 min' },
  { value: '5m', label: '5 min' },
  { value: '10m', label: '10 min' },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1H' },
]

export const PROFIT_TRAILING_OPTIONS: ProfitTrailing[] = [
  'No Trailing',
  'Lock Fix',
  'Trail',
  'Lock & Trail',
]

// ── Option Trading types ─────────────────────────────────────────────────────

export type Underlying = 'Spot' | 'Future'
export type OptionPosition = 'BUY' | 'SELL'
export type OptionType = 'CALL' | 'PUT'
export type ExpiryType = 'WEEKLY' | 'MONTHLY'
export type LegCondition = 'LONG' | 'SHORT'

export interface OptionLeg {
  id: string
  legNumber: number
  condition: LegCondition
  /** Time-based trigger (option-time). HH:mm 24h IST; optional for indicator legs. */
  entryTime?: string
  strikeCriteria: string
  strikeType: string
  qty: number
  position: OptionPosition
  optionType: OptionType
  expiry: ExpiryType
  slType: string
  slValue: string
  tpType: string
  tpValue: string
  trailSlType: string
  trailSlValue: string
  priceMovement: string
  tradingValue: string
  prePunchSl: boolean
  active: boolean
}

// ── Main Builder State ───────────────────────────────────────────────────────

export interface BuilderState {
  id?: string
  strategyType: StrategyType
  strategyName: string

  // Stocks & Futures fields
  instruments: InstrumentHit[]
  sfOrderType: OrderTypeNew
  startTime: string
  squareOffTime: string
  transactionType: TransactionType
  chartType: ChartType
  interval: string
  tradeStrategy: {
    straddle: boolean
    optionsChart: boolean
    spreadChart: boolean
  }
  longEntryConditions: Condition[]
  shortEntryConditions: Condition[]

  // Option Trading fields
  underlying: Underlying
  optOrderType: OrderTypeNew
  legs: OptionLeg[]

  // Exit conditions (shared)
  exitConditionsEnabled: boolean
  exitConditions: Condition[]

  // Risk management (shared)
  exitProfitAmount: string
  exitLossAmount: string
  maxTradeCycle: string
  noTradeAfter: string
  profitTrailing: ProfitTrailing

  // Legacy compat fields (used for save/load with backend)
  segment: Segment
  timeframe: Timeframe
  direction: 'long' | 'short'
  orderType: OrderType
  productType: ProductType
  combinator: 'and' | 'or'
  entryConditions: Condition[]
  exit: ExitUiState
  risk: RiskUiState
  instrument: InstrumentHit | null
  description: string
}

/** UI state for exit (kept for backward compat). */
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

let legCounter = 0
export function newLegId(): string {
  legCounter = (legCounter + 1) % 100000
  return `leg_${Date.now().toString(36)}_${legCounter}`
}

export function newOptionLeg(legNumber: number): OptionLeg {
  return {
    id: newLegId(),
    legNumber,
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
  }
}

export function initialBuilderState(): BuilderState {
  const defaults = defaultRules()
  return {
    strategyType: 'stocks-futures',
    strategyName: '',

    // Stocks & Futures
    instruments: [],
    sfOrderType: 'MIS',
    startTime: '09:16',
    squareOffTime: '15:10',
    transactionType: 'Both Side',
    chartType: 'Candle',
    interval: '5m',
    tradeStrategy: { straddle: false, optionsChart: false, spreadChart: false },
    longEntryConditions: [],
    shortEntryConditions: [],

    // Option Trading
    underlying: 'Spot',
    optOrderType: 'MIS',
    legs: [newOptionLeg(1)],

    // Exit
    exitConditionsEnabled: false,
    exitConditions: [],

    // Risk
    exitProfitAmount: '',
    exitLossAmount: '',
    maxTradeCycle: '1',
    noTradeAfter: '15:10',
    profitTrailing: 'No Trailing',

    // Legacy compat
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
    instrument: null,
    description: '',
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

/** Map new order type to legacy product type for backend compat. */
function toProductType(ot: OrderTypeNew): ProductType {
  if (ot === 'MIS') return 'INTRADAY'
  if (ot === 'CNC') return 'DELIVERY'
  return 'BTST'
}

function groupOf(conditions: Condition[]): ConditionGroup | undefined {
  return conditions.length > 0 ? { combinator: 'and', conditions } : undefined
}

/** Serialize a builder leg into the schema leg shape (drops UI-only id). */
export function serializeLeg(leg: OptionLeg): StrategyRuleLeg {
  return {
    legNumber: leg.legNumber,
    condition: leg.condition,
    entryTime: leg.entryTime,
    strikeCriteria: leg.strikeCriteria,
    strikeType: leg.strikeType,
    qty: leg.qty,
    position: leg.position,
    optionType: leg.optionType,
    expiry: leg.expiry,
    slType: leg.slType,
    slValue: leg.slValue,
    tpType: leg.tpType,
    tpValue: leg.tpValue,
    trailSlType: leg.trailSlType,
    trailSlValue: leg.trailSlValue,
    priceMovement: leg.priceMovement,
    tradingValue: leg.tradingValue,
    prePunchSl: leg.prePunchSl,
    active: leg.active,
  }
}

/** Rehydrate builder legs from a saved schema's legs array. */
export function hydrateLegs(legs?: StrategyRuleLeg[]): OptionLeg[] {
  if (!legs || legs.length === 0) return []
  return legs.map((l) => ({
    id: newLegId(),
    legNumber: l.legNumber,
    condition: l.condition,
    entryTime: l.entryTime,
    strikeCriteria: l.strikeCriteria,
    strikeType: l.strikeType,
    qty: l.qty,
    position: l.position,
    optionType: l.optionType,
    expiry: l.expiry,
    slType: l.slType,
    slValue: l.slValue,
    tpType: l.tpType,
    tpValue: l.tpValue,
    trailSlType: l.trailSlType,
    trailSlValue: l.trailSlValue,
    priceMovement: l.priceMovement,
    tradingValue: l.tradingValue,
    prePunchSl: l.prePunchSl,
    active: l.active,
  }))
}

/** Assemble the persistable rule tree for all strategy types. */
export function toRules(state: BuilderState): StrategyRules {
  // Merge long+short conditions into the engine-consumed entryConditions group.
  const allConditions = [...state.longEntryConditions, ...state.shortEntryConditions]
  const exitRules = state.exit

  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: state.direction },
    entry: { orderType: state.orderType, productType: toProductType(state.sfOrderType) },
    entryConditions: { combinator: 'and', conditions: allConditions.length > 0 ? allConditions : state.entryConditions },
    longEntryConditions: groupOf(state.longEntryConditions),
    shortEntryConditions: groupOf(state.shortEntryConditions),
    legs: state.legs.length > 0 ? state.legs.map(serializeLeg) : undefined,
    exit: {
      ...(exitRules.slEnabled
        ? {
            stopLoss: {
              type: exitRules.slType,
              value: num(exitRules.slValue),
              ...(exitRules.slType === 'atr' ? { atrPeriod: num(exitRules.slAtrPeriod) } : {}),
            },
          }
        : {}),
      ...(exitRules.targetEnabled ? { target: { type: exitRules.targetType, value: num(exitRules.targetValue) } } : {}),
      ...(exitRules.trailingEnabled
        ? { trailingStopLoss: { type: exitRules.trailingType, value: num(exitRules.trailingValue) } }
        : {}),
      ...(exitRules.timeSqEnabled ? { timeSquareOff: { time: exitRules.timeSq } } : {}),
      ...(exitRules.maxHoldEnabled ? { maxHoldingBars: num(exitRules.maxHoldBars) } : {}),
    },
    risk: {
      quantity: num(state.risk.quantity),
      ...(state.risk.capitalAllocPercent.trim() ? { capitalAllocationPercent: num(state.risk.capitalAllocPercent) } : {}),
      maxConcurrentPositions: num(state.risk.maxPositions),
      maxTradesPerDay: num(state.risk.maxTradesPerDay),
    },
  }
}

/** Hydrate the builder from a saved strategy (edit mode). */
export function fromStrategyRow(row: StrategyRowView): BuilderState {
  const r = row.rules
  return {
    ...initialBuilderState(),
    id: row.id,
    strategyName: row.name,
    strategyType: row.segment === 'options' ? 'option-indicator' : 'stocks-futures',
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
    instruments: [
      {
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
    ],
    segment: row.segment,
    timeframe: row.timeframe as Timeframe,
    interval: row.timeframe,
    direction: r.direction.side,
    orderType: r.entry.orderType,
    productType: r.entry.productType,
    sfOrderType: r.entry.productType === 'INTRADAY' ? 'MIS' : r.entry.productType === 'DELIVERY' ? 'CNC' : 'BTST',
    combinator: r.entryConditions.combinator,
    entryConditions: r.entryConditions.conditions,
    longEntryConditions: r.longEntryConditions?.conditions ?? (r.direction.side === 'long' ? r.entryConditions.conditions : []),
    shortEntryConditions: r.shortEntryConditions?.conditions ?? (r.direction.side === 'short' ? r.entryConditions.conditions : []),
    legs: hydrateLegs(r.legs),
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
    exitConditionsEnabled: false,
    exitConditions: [],
  }
}

/** Per-step gating for the wizard's Next button. */
export function stepErrors(state: BuilderState, step: number): string[] {
  const errors: string[] = []
  if (step === 0) {
    if (!state.strategyName.trim()) errors.push('Strategy name is required')
    if (state.strategyType === 'stocks-futures' && state.instruments.length === 0) errors.push('Choose at least one instrument')
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
