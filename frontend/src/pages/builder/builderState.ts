import {
  RULE_SCHEMA_VERSION,
  TRADING_DAYS,
  defaultTradingDays,
  newConditionId,
  normalizeOrderType,
  normalizeRiskManagement,
  normalizeOptionExecution,
  productTypeForOrderType,
  defaultRules,
} from '@algo/rule-schema'
import type {
  Condition,
  ConditionGroup,
  ExitRules,
  OrderType,
  OrderTypeConfig,
  ProductType,
  ProfitTrailingConfig,
  ProfitTrailingType,
  RiskManagementConfig,
  Segment,
  StopLossRule,
  StrategyRuleLeg,
  StrategyRules,
  TargetRule,
  Timeframe,
  TradingDay,
  TrailingSlRule,
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

/** UI label ↔ persisted enum for the Profit Trailing radio group. */
export const PROFIT_TRAILING_MAP: Record<ProfitTrailing, ProfitTrailingType> = {
  'No Trailing': 'NO_TRAILING',
  'Lock Fix': 'LOCK_FIX_PROFIT',
  Trail: 'TRAIL_PROFIT',
  'Lock & Trail': 'LOCK_AND_TRAIL',
}

export const PROFIT_TRAILING_LABELS: Record<ProfitTrailingType, ProfitTrailing> = {
  NO_TRAILING: 'No Trailing',
  LOCK_FIX_PROFIT: 'Lock Fix',
  TRAIL_PROFIT: 'Trail',
  LOCK_AND_TRAIL: 'Lock & Trail',
}

/** Long-form captions shown next to each Profit Trailing radio. */
export const PROFIT_TRAILING_DESCRIPTIONS: Record<ProfitTrailing, string> = {
  'No Trailing': 'No additional profit protection',
  'Lock Fix': 'Lock a fixed profit once a threshold is hit',
  Trail: 'Trail profit upward as gains increase',
  'Lock & Trail': 'Lock a floor, then keep trailing above it',
}

export const TRADING_DAY_OPTIONS: readonly TradingDay[] = TRADING_DAYS

export const CNC_SLIDER_MIN = 0
export const CNC_SLIDER_MAX = 4

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
  underlyingInstrument: InstrumentHit | null
  optOrderType: OrderTypeNew
  legs: OptionLeg[]
  /** Absolute-delta entry floor (0 disables the filter). */
  optionMinAbsDelta: string
  optionExpiryBufferMinutes: string
  /** Percent values in the UI; serialized as decimals. */
  optionRiskFreeRatePercent: string
  optionImpliedVolatilityPercent: string

  // Exit conditions (shared)
  exitConditionsEnabled: boolean
  exitConditions: Condition[]

  // Order Type configuration (shared — MIS / CNC / BTST)
  /** Trading days the strategy may run (MON…FRI). */
  tradingDays: TradingDay[]
  /** BTST only — square off on the following session. */
  nextDaySquareOffTime: string
  /** CNC only — entry N trading days before expiry (0…4). */
  cncEntryDaysBeforeExpiry: number
  /** CNC only — exit N trading days before expiry (0…4). */
  cncExitDaysBeforeExpiry: number
  /** UI-only: CNC Settings card expanded/collapsed. */
  cncSettingsOpen: boolean

  // Risk management (shared)
  exitProfitAmount: string
  exitLossAmount: string
  maxTradeCycle: string
  noTradeAfter: string
  profitTrailing: ProfitTrailing
  /** Profit trailing values — required only for the selected trailing mode. */
  trailIfProfitReaches: string
  trailLockProfitAt: string
  trailOnEveryIncreaseOf: string
  trailProfitBy: string

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

    // Order Type configuration
    tradingDays: defaultTradingDays(),
    nextDaySquareOffTime: '15:10',
    cncEntryDaysBeforeExpiry: 4,
    cncExitDaysBeforeExpiry: 0,
    cncSettingsOpen: true,
    transactionType: 'Both Side',
    chartType: 'Candle',
    interval: '5m',
    tradeStrategy: { straddle: false, optionsChart: false, spreadChart: false },
    longEntryConditions: [],
    shortEntryConditions: [],

    // Option Trading
    underlying: 'Spot',
    underlyingInstrument: null,
    optOrderType: 'MIS',
    legs: [newOptionLeg(1)],
    optionMinAbsDelta: '0.5',
    optionExpiryBufferMinutes: '30',
    optionRiskFreeRatePercent: '6',
    optionImpliedVolatilityPercent: '20',

    // Exit
    exitConditionsEnabled: false,
    exitConditions: [],

    // Risk — these are the fields the builder actually shows.
    // Leave empty so toRules can fall back to per-leg SL / square-off time.
    exitProfitAmount: '',
    exitLossAmount: '',
    maxTradeCycle: '1',
    noTradeAfter: '15:10',
    profitTrailing: 'No Trailing',
    trailIfProfitReaches: '',
    trailLockProfitAt: '',
    trailOnEveryIncreaseOf: '',
    trailProfitBy: '',

    // Legacy compat
    segment: 'equity',
    timeframe: '5m',
    direction: defaults.direction.side,
    orderType: defaults.entry.orderType,
    productType: defaults.entry.productType,
    combinator: 'and',
    entryConditions: [],
    exit: {
      slEnabled: false,
      slType: 'points',
      slValue: '',
      slAtrPeriod: '14',
      targetEnabled: false,
      targetType: 'rr_multiple',
      targetValue: '2',
      trailingEnabled: false,
      trailingType: 'points',
      trailingValue: '',
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

/** Parse a builder input as a positive amount. Accepts "1000" and "-2000". */
export function parsePositiveAmount(raw: string | number | undefined | null): number | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n === 0) return undefined
  return Math.abs(n)
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isOptionStrategy(type: StrategyType): boolean {
  return type === 'option-indicator' || type === 'option-time'
}

function mapUiSlType(raw: string): StopLossRule['type'] {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('atr')) return 'atr'
  if (s.includes('%') || s.includes('percent')) return 'percent'
  return 'points'
}

function mapUiTpType(raw: string): TargetRule['type'] {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('rr') || s.includes('risk')) return 'rr_multiple'
  if (s.includes('%') || s.includes('percent')) return 'percent'
  return 'points'
}

function mapUiTrailType(raw: string): TrailingSlRule['type'] {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('%') || s.includes('percent')) return 'percent'
  return 'points'
}

/**
 * Build exit.stopLoss from the fields the user actually edits:
 *   1. Exit Loss (INR)  — risk-management section
 *   2. Strategy-leg Stop Loss (option strategies)
 *   3. Legacy Exit-step SL (old wizard)
 * Never emit value 0 — that trips `exit.stopLoss.value must be > 0`.
 */
export function deriveStopLoss(state: BuilderState): StopLossRule | undefined {
  const overallLoss = parsePositiveAmount(state.exitLossAmount)
  if (overallLoss != null) {
    return { type: 'points', value: overallLoss }
  }

  if (isOptionStrategy(state.strategyType)) {
    const slLeg = state.legs.find((l) => l.active !== false && parsePositiveAmount(l.slValue) != null)
    if (slLeg) {
      return { type: mapUiSlType(slLeg.slType), value: parsePositiveAmount(slLeg.slValue)! }
    }
  }

  if (state.exit.slEnabled) {
    const legacy = parsePositiveAmount(state.exit.slValue)
    if (legacy != null) {
      return {
        type: state.exit.slType,
        value: legacy,
        ...(state.exit.slType === 'atr' ? { atrPeriod: parsePositiveAmount(state.exit.slAtrPeriod) ?? 14 } : {}),
      }
    }
  }
  return undefined
}

function deriveTarget(state: BuilderState, hasStopLoss: boolean): TargetRule | undefined {
  const overallProfit = parsePositiveAmount(state.exitProfitAmount)
  if (overallProfit != null) {
    return { type: 'points', value: overallProfit }
  }

  if (isOptionStrategy(state.strategyType)) {
    const tpLeg = state.legs.find((l) => l.active !== false && parsePositiveAmount(l.tpValue) != null)
    if (tpLeg) {
      const type = mapUiTpType(tpLeg.tpType)
      if (type === 'rr_multiple' && !hasStopLoss) return undefined
      return { type, value: parsePositiveAmount(tpLeg.tpValue)! }
    }
  }

  if (state.exit.targetEnabled) {
    const legacy = parsePositiveAmount(state.exit.targetValue)
    if (legacy != null) {
      if (state.exit.targetType === 'rr_multiple' && !hasStopLoss) return undefined
      return { type: state.exit.targetType, value: legacy }
    }
  }
  return undefined
}

function deriveTrailing(state: BuilderState): TrailingSlRule | undefined {
  if (state.exit.trailingEnabled) {
    const v = parsePositiveAmount(state.exit.trailingValue)
    if (v != null) return { type: state.exit.trailingType, value: v }
  }
  if (state.profitTrailing && state.profitTrailing !== 'No Trailing' && isOptionStrategy(state.strategyType)) {
    const trailLeg = state.legs.find((l) => l.active !== false && parsePositiveAmount(l.trailSlValue) != null)
    if (trailLeg) {
      return { type: mapUiTrailType(trailLeg.trailSlType), value: parsePositiveAmount(trailLeg.trailSlValue)! }
    }
  }
  return undefined
}

function deriveTimeSquareOff(state: BuilderState): { time: string } | undefined {
  if (TIME_RE.test(state.squareOffTime)) return { time: state.squareOffTime }
  if (state.exit.timeSqEnabled && TIME_RE.test(state.exit.timeSq)) return { time: state.exit.timeSq }
  return undefined
}

function deriveExit(state: BuilderState): ExitRules {
  const stopLoss = deriveStopLoss(state)
  const target = deriveTarget(state, stopLoss != null)
  const trailingStopLoss = deriveTrailing(state)
  const timeSquareOff = deriveTimeSquareOff(state)
  const overallProfitAmount = parsePositiveAmount(state.exitProfitAmount)
  const overallLossAmount = parsePositiveAmount(state.exitLossAmount)

  return {
    ...(stopLoss ? { stopLoss } : {}),
    ...(target ? { target } : {}),
    ...(trailingStopLoss ? { trailingStopLoss } : {}),
    ...(timeSquareOff ? { timeSquareOff } : {}),
    ...(state.exit.maxHoldEnabled ? { maxHoldingBars: num(state.exit.maxHoldBars) } : {}),
    ...(overallProfitAmount != null ? { overallProfitAmount } : {}),
    ...(overallLossAmount != null ? { overallLossAmount } : {}),
  }
}

/** Map new order type to legacy product type for backend compat. */
function toProductType(ot: OrderTypeNew): ProductType {
  return productTypeForOrderType(ot)
}

/** Which order-type selector applies to the active strategy type. */
export function activeOrderType(state: BuilderState): OrderTypeNew {
  return state.strategyType === 'stocks-futures' ? state.sfOrderType : state.optOrderType
}

/**
 * Build the persisted Order Type block. Only the fields relevant to the
 * selected type are emitted — CNC settings never leak into a MIS strategy and
 * BTST's next-day square off is null for MIS/CNC.
 */
export function toOrderTypeConfig(state: BuilderState): OrderTypeConfig {
  const type = activeOrderType(state)
  return {
    type,
    startTime: state.startTime,
    squareOffTime: type === 'BTST' ? null : state.squareOffTime,
    nextDaySquareOffTime: type === 'BTST' ? state.nextDaySquareOffTime : null,
    tradingDays: [...state.tradingDays],
    ...(type === 'CNC'
      ? {
          cnc: {
            entryDaysBeforeExpiry: state.cncEntryDaysBeforeExpiry,
            exitDaysBeforeExpiry: state.cncExitDaysBeforeExpiry,
          },
        }
      : {}),
  }
}

/**
 * Build the persisted Risk Management block. Trailing values are emitted only
 * for the selected mode, so switching modes never persists stale numbers.
 */
export function toRiskManagementConfig(state: BuilderState): RiskManagementConfig {
  const type = PROFIT_TRAILING_MAP[state.profitTrailing] ?? 'NO_TRAILING'
  const needsLock = type === 'LOCK_FIX_PROFIT' || type === 'LOCK_AND_TRAIL'
  const needsTrail = type === 'TRAIL_PROFIT' || type === 'LOCK_AND_TRAIL'
  const n = (raw: string): number | undefined => {
    const v = raw?.trim()
    if (!v) return undefined
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const profitTrailing: ProfitTrailingConfig = {
    type,
    ...(needsLock && n(state.trailIfProfitReaches) != null ? { ifProfitReaches: n(state.trailIfProfitReaches)! } : {}),
    ...(needsLock && n(state.trailLockProfitAt) != null ? { lockProfitAt: n(state.trailLockProfitAt)! } : {}),
    ...(needsTrail && n(state.trailOnEveryIncreaseOf) != null
      ? { onEveryIncreaseOf: n(state.trailOnEveryIncreaseOf)! }
      : {}),
    ...(needsTrail && n(state.trailProfitBy) != null ? { trailProfitBy: n(state.trailProfitBy)! } : {}),
  }
  const exitProfit = parsePositiveAmount(state.exitProfitAmount)
  const exitLoss = parsePositiveAmount(state.exitLossAmount)
  const cycles = Number(state.maxTradeCycle)
  return {
    ...(exitProfit != null ? { exitProfit } : {}),
    ...(exitLoss != null ? { exitLoss } : {}),
    maxTradeCycle: Number.isFinite(cycles) && cycles >= 1 ? Math.round(cycles) : 1,
    noTradeAfter: state.noTradeAfter,
    profitTrailing,
  }
}

function groupOf(conditions: Condition[]): ConditionGroup | undefined {
  return conditions.length > 0 ? { combinator: 'and', conditions } : undefined
}

/** Serialize a builder leg into the schema leg shape (drops UI-only id). */
export function serializeLeg(leg: OptionLeg, includeEntryTime = true): StrategyRuleLeg {
  return {
    legNumber: leg.legNumber,
    condition: leg.condition,
    ...(includeEntryTime ? { entryTime: leg.entryTime } : {}),
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
  // Keep the legacy group actionable without combining mutually-exclusive
  // long and short signals. New engines consume the split groups directly.
  const legacyConditions =
    (state.direction === 'short' ? state.shortEntryConditions : state.longEntryConditions).length > 0
      ? state.direction === 'short'
        ? state.shortEntryConditions
        : state.longEntryConditions
      : state.entryConditions
  const orderTypeNew = state.strategyType === 'stocks-futures' ? state.sfOrderType : state.optOrderType
  const optionLegs = isOptionStrategy(state.strategyType) ? state.legs : []
  const minAbsDelta = Number(state.optionMinAbsDelta)
  const expiryBufferMinutes = Number(state.optionExpiryBufferMinutes)
  const riskFreeRate = Number(state.optionRiskFreeRatePercent) / 100
  const impliedVolatility = Number(state.optionImpliedVolatilityPercent) / 100

  return {
    version: RULE_SCHEMA_VERSION,
    strategyType: state.strategyType,
    direction: { side: state.direction },
    entry: { orderType: state.orderType, productType: toProductType(orderTypeNew) },
    entryConditions: { combinator: state.combinator, conditions: legacyConditions },
    longEntryConditions: groupOf(state.longEntryConditions),
    shortEntryConditions: groupOf(state.shortEntryConditions),
    legs:
      optionLegs.length > 0
        ? optionLegs.map((leg) => serializeLeg(leg, state.strategyType === 'option-time'))
        : undefined,
    ...(state.strategyType === 'option-indicator'
      ? { tradeConfiguration: { transactionType: state.transactionType, chartType: state.chartType } }
      : {}),
    ...(isOptionStrategy(state.strategyType)
      ? {
          optionExecution: {
            ...(state.strategyType === 'option-indicator' && Number.isFinite(minAbsDelta) && minAbsDelta > 0
              ? { minAbsDelta }
              : {}),
            expiryBufferMinutes: Number.isFinite(expiryBufferMinutes) ? Math.round(expiryBufferMinutes) : 30,
            riskFreeRate: Number.isFinite(riskFreeRate) ? riskFreeRate : 0.06,
            impliedVolatility: Number.isFinite(impliedVolatility) ? impliedVolatility : 0.2,
          },
        }
      : {}),
    exit: deriveExit(state),
    risk: {
      quantity: num(state.risk.quantity),
      ...(state.risk.capitalAllocPercent.trim() ? { capitalAllocationPercent: num(state.risk.capitalAllocPercent) } : {}),
      maxConcurrentPositions: num(state.risk.maxPositions),
      maxTradesPerDay: num(state.risk.maxTradesPerDay),
    },
    // Time Based keeps the pre-dynamic schema: broker product type + legacy
    // timing fields. Only Stocks/Futures and Option Indicator persist the new
    // Order Type block.
    ...(state.strategyType !== 'option-time' ? { orderType: toOrderTypeConfig(state) } : {}),
    riskManagement: toRiskManagementConfig(state),
  }
}

/** Hydrate the builder from a saved strategy (edit mode). */
export function fromStrategyRow(row: StrategyRowView): BuilderState {
  const r = row.rules
  const optionTime =
    r.strategyType === 'option-time' ||
    (r.strategyType == null &&
      (r.legs ?? []).some((l) => Boolean(l.entryTime)) &&
      (r.longEntryConditions?.conditions.length ?? 0) === 0 &&
      (r.shortEntryConditions?.conditions.length ?? 0) === 0)
  const restoredLoss =
    r.exit.overallLossAmount != null
      ? String(r.exit.overallLossAmount)
      : r.exit.stopLoss?.type === 'points'
        ? String(r.exit.stopLoss.value)
        : ''
  const restoredProfit =
    r.exit.overallProfitAmount != null
      ? String(r.exit.overallProfitAmount)
      : r.exit.target?.type === 'points'
        ? String(r.exit.target.value)
        : ''
  return {
    ...initialBuilderState(),
    id: row.id,
    strategyName: row.name,
    strategyType: row.segment === 'options' ? (optionTime ? 'option-time' : 'option-indicator') : 'stocks-futures',
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
    underlyingInstrument: {
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
    interval: row.timeframe,
    transactionType: r.tradeConfiguration?.transactionType ?? 'Both Side',
    chartType: r.tradeConfiguration?.chartType ?? 'Candle',
    direction: r.direction.side,
    orderType: r.entry.orderType,
    productType: r.entry.productType,
    combinator: r.entryConditions.combinator,
    entryConditions: r.entryConditions.conditions,
    longEntryConditions: r.longEntryConditions?.conditions ?? (r.direction.side === 'long' ? r.entryConditions.conditions : []),
    shortEntryConditions: r.shortEntryConditions?.conditions ?? (r.direction.side === 'short' ? r.entryConditions.conditions : []),
    legs: (() => {
      const hydrated = hydrateLegs(r.legs)
      return hydrated.length > 0 ? hydrated : initialBuilderState().legs
    })(),
    ...(() => {
      // Order Type + Risk Management restore. normalize* derives sane values
      // for strategies saved before the feature existed, so editing an old
      // strategy never opens with blank/incorrect sections.
      const ot = normalizeOrderType(r)
      const rm = normalizeRiskManagement(r)
      const oe = normalizeOptionExecution(r)
      const trailing = rm.profitTrailing
      const str = (v: number | undefined): string => (v == null ? '' : String(v))
      return {
        sfOrderType: ot.type,
        optOrderType: ot.type,
        startTime: ot.startTime,
        squareOffTime: ot.squareOffTime ?? '15:10',
        nextDaySquareOffTime: ot.nextDaySquareOffTime ?? '15:10',
        tradingDays: ot.tradingDays,
        cncEntryDaysBeforeExpiry: ot.cnc?.entryDaysBeforeExpiry ?? 4,
        cncExitDaysBeforeExpiry: ot.cnc?.exitDaysBeforeExpiry ?? 0,
        cncSettingsOpen: true,
        maxTradeCycle: String(rm.maxTradeCycle),
        noTradeAfter: rm.noTradeAfter,
        profitTrailing: PROFIT_TRAILING_LABELS[trailing.type] ?? 'No Trailing',
        trailIfProfitReaches: str(trailing.ifProfitReaches),
        trailLockProfitAt: str(trailing.lockProfitAt),
        trailOnEveryIncreaseOf: str(trailing.onEveryIncreaseOf),
        trailProfitBy: str(trailing.trailProfitBy),
        exitProfitAmount: rm.exitProfit != null ? String(rm.exitProfit) : restoredProfit,
        exitLossAmount: rm.exitLoss != null ? String(rm.exitLoss) : restoredLoss,
        optionMinAbsDelta: oe.minAbsDelta == null ? '0' : String(oe.minAbsDelta),
        optionExpiryBufferMinutes: String(oe.expiryBufferMinutes),
        optionRiskFreeRatePercent: String(oe.riskFreeRate * 100),
        optionImpliedVolatilityPercent: String(oe.impliedVolatility * 100),
      }
    })(),
    exit: {
      slEnabled: r.exit.stopLoss != null && Number(r.exit.stopLoss.value) > 0,
      slType: r.exit.stopLoss?.type ?? 'points',
      slValue: r.exit.stopLoss != null && Number(r.exit.stopLoss.value) > 0 ? String(r.exit.stopLoss.value) : '',
      slAtrPeriod: String(r.exit.stopLoss?.atrPeriod ?? 14),
      targetEnabled: r.exit.target != null && Number(r.exit.target.value) > 0,
      targetType: r.exit.target?.type ?? 'rr_multiple',
      targetValue: String(r.exit.target?.value ?? 2),
      trailingEnabled: r.exit.trailingStopLoss != null && Number(r.exit.trailingStopLoss.value) > 0,
      trailingType: r.exit.trailingStopLoss?.type ?? 'points',
      trailingValue: r.exit.trailingStopLoss != null ? String(r.exit.trailingStopLoss.value) : '',
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

/**
 * Order Type + Risk Management validation for the builder form. Runs the SAME
 * shared validators the backend uses (validateOrderTypeConfig /
 * validateRiskManagementConfig) against the serialized blocks, then adds a few
 * UI-level messages phrased in the form's own language.
 */
export function configErrors(state: BuilderState): string[] {
  const errors: string[] = []
  const type = activeOrderType(state)

  if (!TIME_RE.test(state.startTime)) errors.push('Start Time must be a valid time')

  if (state.strategyType === 'option-time') {
    // Original Time Based form always uses the same-day Square Off field,
    // regardless of which broker product radio is selected.
    if (!TIME_RE.test(state.squareOffTime)) errors.push('Square Off must be a valid time')
    else if (TIME_RE.test(state.startTime) && state.startTime >= state.squareOffTime) {
      errors.push('Start Time must be before Square Off')
    }
  } else {
    if (type === 'BTST') {
      if (!TIME_RE.test(state.nextDaySquareOffTime)) errors.push('Next Day Square Off must be a valid time')
    } else {
      if (!TIME_RE.test(state.squareOffTime)) errors.push('Square Off must be a valid time')
      else if (TIME_RE.test(state.startTime) && state.startTime >= state.squareOffTime) {
        errors.push('Start Time must be before Square Off')
      }
    }

    if (state.tradingDays.length === 0) errors.push('Select at least one trading day')

    if (type === 'CNC') {
      for (const [label, value] of [
        ['Entry', state.cncEntryDaysBeforeExpiry],
        ['Exit', state.cncExitDaysBeforeExpiry],
      ] as const) {
        if (!Number.isInteger(value) || value < CNC_SLIDER_MIN || value > CNC_SLIDER_MAX) {
          errors.push(`CNC ${label} days before expiry must be between ${CNC_SLIDER_MIN} and ${CNC_SLIDER_MAX}`)
        }
      }
    }
  }

  // Risk management
  for (const [label, raw] of [
    ['Exit Profit (INR)', state.exitProfitAmount],
    ['Exit Loss (INR)', state.exitLossAmount],
  ] as const) {
    const v = raw?.trim()
    if (v && !Number.isFinite(Number(v))) errors.push(`${label} must be a valid number`)
    else if (v && Number(v) === 0) errors.push(`${label} must not be zero`)
  }

  const cycles = Number(state.maxTradeCycle)
  if (!state.maxTradeCycle.trim() || !Number.isFinite(cycles) || !Number.isInteger(cycles) || cycles < 1) {
    errors.push('Max Trade Cycle must be a positive whole number')
  }
  if (!TIME_RE.test(state.noTradeAfter)) errors.push('No Trade After must be a valid time')

  // Trailing fields are required ONLY for the selected trailing option.
  const trailingRequirements: Record<ProfitTrailing, [string, string][]> = {
    'No Trailing': [],
    'Lock Fix': [
      ['If profit reaches', state.trailIfProfitReaches],
      ['Lock profit at', state.trailLockProfitAt],
    ],
    Trail: [
      ['On every increase of', state.trailOnEveryIncreaseOf],
      ['Trail profit by', state.trailProfitBy],
    ],
    'Lock & Trail': [
      ['If profit reaches', state.trailIfProfitReaches],
      ['Lock profit at', state.trailLockProfitAt],
      ['On every increase of', state.trailOnEveryIncreaseOf],
      ['Trail profit by', state.trailProfitBy],
    ],
  }
  for (const [label, raw] of trailingRequirements[state.profitTrailing]) {
    const v = raw?.trim()
    if (!v) errors.push(`${label} is required for ${state.profitTrailing} trailing`)
    else if (!Number.isFinite(Number(v)) || Number(v) <= 0) errors.push(`${label} must be a positive number`)
  }

  if (isOptionStrategy(state.strategyType)) {
    const delta = Number(state.optionMinAbsDelta)
    if (!Number.isFinite(delta) || delta < 0 || delta > 1) errors.push('Minimum absolute delta must be between 0 and 1')
    const buffer = Number(state.optionExpiryBufferMinutes)
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 1440) errors.push('Expiry buffer must be 0–1440 whole minutes')
    const rate = Number(state.optionRiskFreeRatePercent)
    if (!Number.isFinite(rate) || rate < -100 || rate > 100) errors.push('Risk-free rate must be between -100% and 100%')
    const iv = Number(state.optionImpliedVolatilityPercent)
    if (!Number.isFinite(iv) || iv <= 0 || iv > 500) errors.push('Implied volatility must be greater than 0% and at most 500%')
  }

  return errors
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
