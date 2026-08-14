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

export const PRODUCT_TYPES = ['INTRADAY', 'DELIVERY', 'MARGIN', 'BTST'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

/**
 * Builder-facing order type (spec: Order Type section).
 *   MIS  — Intraday          → square off same day
 *   CNC  — Delivery          → expiry-relative entry/exit windows
 *   BTST — Buy Today Sell Tomorrow → square off next day
 */
export const ORDER_TYPE_KINDS = ['MIS', 'CNC', 'BTST'] as const
export type OrderTypeKind = (typeof ORDER_TYPE_KINDS)[number]

export const TRADING_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const
export type TradingDay = (typeof TRADING_DAYS)[number]

/** Profit-trailing modes (spec: Risk Management → Profit Trailing). */
export const PROFIT_TRAILING_TYPES = ['NO_TRAILING', 'LOCK_FIX_PROFIT', 'TRAIL_PROFIT', 'LOCK_AND_TRAIL'] as const
export type ProfitTrailingType = (typeof PROFIT_TRAILING_TYPES)[number]

/** CNC entry/exit are expressed in trading days before expiry, clamped 0…4. */
export const CNC_DAYS_MIN = 0
export const CNC_DAYS_MAX = 4

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

// ── Option strategy legs (spec: builder legs for option-time & option-indicator) ─

export type LegCondition = 'LONG' | 'SHORT'
export type OptionPosition = 'BUY' | 'SELL'
export type OptionType = 'CALL' | 'PUT'
export type ExpiryType = 'WEEKLY' | 'MONTHLY'

export interface StrategyRuleLeg {
  legNumber: number
  condition: LegCondition
  /** Time-based trigger (option-time). ISO-style "HH:mm" IST; optional for indicator legs. */
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
  /** Portfolio-level overall profit lock in INR (builder Risk Management). */
  overallProfitAmount?: number
  /** Portfolio-level overall loss limit in INR (builder Risk Management). */
  overallLossAmount?: number
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

// ── Order type configuration (spec: Order Type section) ─────────────────────

/** CNC-only settings — entry/exit windows relative to the contract expiry. */
export interface CncSettings {
  /** Enter this many trading days BEFORE expiry (0…4). */
  entryDaysBeforeExpiry: number
  /** Exit this many trading days BEFORE expiry (0…4). */
  exitDaysBeforeExpiry: number
}

export interface OrderTypeConfig {
  type: OrderTypeKind
  /** HH:mm IST — first minute the strategy may enter. */
  startTime: string
  /** HH:mm IST — same-day square off (MIS & CNC). Null for BTST. */
  squareOffTime: string | null
  /** HH:mm IST — next-day square off (BTST only). Null otherwise. */
  nextDaySquareOffTime: string | null
  /** Weekdays the strategy is allowed to trade. */
  tradingDays: TradingDay[]
  /** Present only when type === 'CNC'. */
  cnc?: CncSettings
}

// ── Risk management (spec: Risk Management + Profit Trailing) ───────────────

export interface ProfitTrailingConfig {
  type: ProfitTrailingType
  /** LOCK_FIX_PROFIT / LOCK_AND_TRAIL — arm the lock once profit reaches this INR. */
  ifProfitReaches?: number
  /** LOCK_FIX_PROFIT / LOCK_AND_TRAIL — floor profit at this INR once armed. */
  lockProfitAt?: number
  /** TRAIL_PROFIT / LOCK_AND_TRAIL — ratchet step in INR of profit gained. */
  onEveryIncreaseOf?: number
  /** TRAIL_PROFIT / LOCK_AND_TRAIL — INR the locked floor advances per step. */
  trailProfitBy?: number
}

export interface RiskManagementConfig {
  /** Book the whole strategy at this overall profit (INR). */
  exitProfit?: number
  /** Positive INR overall loss limit. */
  exitLoss?: number
  /** Max entry→exit cycles allowed per trading day. */
  maxTradeCycle: number
  /** HH:mm IST — no NEW trades after this time. */
  noTradeAfter: string
  profitTrailing: ProfitTrailingConfig
}

export interface StrategyRules {
  version: typeof RULE_SCHEMA_VERSION
  direction: TradeDirection
  entry: { orderType: OrderType; productType: ProductType }
  entryConditions: ConditionGroup
  /** Optional split of entry conditions into long vs short signals (stocks-futures & option-indicator). */
  longEntryConditions?: ConditionGroup
  shortEntryConditions?: ConditionGroup
  /** Option strategy legs (option-indicator & option-time). */
  legs?: StrategyRuleLeg[]
  exit: ExitRules
  risk: RiskRules
  /**
   * Order Type block (MIS / CNC / BTST + session window + trading days).
   * Optional on the type so strategies saved before this feature keep loading;
   * `normalizeOrderType()` fills sensible defaults on read.
   */
  orderType?: OrderTypeConfig
  /**
   * Risk Management block (global exit profit/loss, trade cycle cap, no-trade
   * cutoff, profit trailing). Optional for the same backward-compat reason —
   * use `normalizeRiskManagement()` when reading.
   */
  riskManagement?: RiskManagementConfig
}

// ── Order type / risk management defaults + normalizers ─────────────────────

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function defaultTradingDays(): TradingDay[] {
  return [...TRADING_DAYS]
}

export function defaultCncSettings(): CncSettings {
  return { entryDaysBeforeExpiry: 4, exitDaysBeforeExpiry: 0 }
}

export function defaultOrderType(type: OrderTypeKind = 'MIS'): OrderTypeConfig {
  return {
    type,
    startTime: '09:16',
    squareOffTime: type === 'BTST' ? null : '15:10',
    nextDaySquareOffTime: type === 'BTST' ? '15:10' : null,
    tradingDays: defaultTradingDays(),
    ...(type === 'CNC' ? { cnc: defaultCncSettings() } : {}),
  }
}

export function defaultProfitTrailing(): ProfitTrailingConfig {
  return { type: 'NO_TRAILING' }
}

export function defaultRiskManagement(): RiskManagementConfig {
  return { maxTradeCycle: 1, noTradeAfter: '15:10', profitTrailing: defaultProfitTrailing() }
}

/** Map the builder order type onto the broker product type the engines use. */
export function productTypeForOrderType(type: OrderTypeKind): ProductType {
  if (type === 'MIS') return 'INTRADAY'
  if (type === 'CNC') return 'DELIVERY'
  return 'BTST'
}

/** Inverse of `productTypeForOrderType` — used to hydrate pre-feature strategies. */
export function orderTypeForProductType(product: ProductType | undefined): OrderTypeKind {
  if (product === 'DELIVERY' || product === 'MARGIN') return 'CNC'
  if (product === 'BTST') return 'BTST'
  return 'MIS'
}

const finite = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = finite(v)
  if (n == null) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Read the Order Type block off any saved strategy — including ones written
 * before the feature existed, where it is derived from entry.productType and
 * exit.timeSquareOff so the builder still opens with meaningful values.
 */
export function normalizeOrderType(rules: Partial<StrategyRules> | undefined): OrderTypeConfig {
  const raw = rules?.orderType
  const fallbackType = raw?.type && (ORDER_TYPE_KINDS as readonly string[]).includes(raw.type)
    ? raw.type
    : orderTypeForProductType(rules?.entry?.productType)
  const base = defaultOrderType(fallbackType)
  if (!raw) {
    // Legacy strategy: recover the square-off time from the exit rules.
    const legacyTime = rules?.exit?.timeSquareOff?.time
    if (legacyTime && HHMM_RE.test(legacyTime)) {
      if (fallbackType === 'BTST') base.nextDaySquareOffTime = legacyTime
      else base.squareOffTime = legacyTime
    }
    return base
  }
  const days = Array.isArray(raw.tradingDays)
    ? (TRADING_DAYS as readonly string[]).filter((d) => raw.tradingDays.includes(d as TradingDay)) as TradingDay[]
    : base.tradingDays
  const startTime = typeof raw.startTime === 'string' && HHMM_RE.test(raw.startTime) ? raw.startTime : base.startTime
  const squareOffTime =
    fallbackType === 'BTST'
      ? null
      : typeof raw.squareOffTime === 'string' && HHMM_RE.test(raw.squareOffTime)
        ? raw.squareOffTime
        : base.squareOffTime
  const nextDaySquareOffTime =
    fallbackType === 'BTST'
      ? typeof raw.nextDaySquareOffTime === 'string' && HHMM_RE.test(raw.nextDaySquareOffTime)
        ? raw.nextDaySquareOffTime
        : (base.nextDaySquareOffTime ?? '15:10')
      : null
  return {
    type: fallbackType,
    startTime,
    squareOffTime,
    nextDaySquareOffTime,
    tradingDays: days.length > 0 ? days : defaultTradingDays(),
    ...(fallbackType === 'CNC'
      ? {
          cnc: {
            entryDaysBeforeExpiry: clampInt(raw.cnc?.entryDaysBeforeExpiry, CNC_DAYS_MIN, CNC_DAYS_MAX, 4),
            exitDaysBeforeExpiry: clampInt(raw.cnc?.exitDaysBeforeExpiry, CNC_DAYS_MIN, CNC_DAYS_MAX, 0),
          },
        }
      : {}),
  }
}

/**
 * Read the Risk Management block off any saved strategy, falling back to the
 * pre-feature `exit.overallProfitAmount` / `overallLossAmount` fields.
 */
export function normalizeRiskManagement(rules: Partial<StrategyRules> | undefined): RiskManagementConfig {
  const raw = rules?.riskManagement
  const base = defaultRiskManagement()
  const legacyProfit = finite(rules?.exit?.overallProfitAmount)
  const legacyLoss = finite(rules?.exit?.overallLossAmount)
  if (!raw) {
    return {
      ...base,
      ...(legacyProfit != null && legacyProfit > 0 ? { exitProfit: legacyProfit } : {}),
      ...(legacyLoss != null && legacyLoss > 0 ? { exitLoss: Math.abs(legacyLoss) } : {}),
      ...(rules?.exit?.timeSquareOff?.time && HHMM_RE.test(rules.exit.timeSquareOff.time)
        ? { noTradeAfter: rules.exit.timeSquareOff.time }
        : {}),
    }
  }
  const trailingType =
    raw.profitTrailing?.type && (PROFIT_TRAILING_TYPES as readonly string[]).includes(raw.profitTrailing.type)
      ? raw.profitTrailing.type
      : 'NO_TRAILING'
  const t = raw.profitTrailing ?? {}
  const needsLock = trailingType === 'LOCK_FIX_PROFIT' || trailingType === 'LOCK_AND_TRAIL'
  const needsTrail = trailingType === 'TRAIL_PROFIT' || trailingType === 'LOCK_AND_TRAIL'
  const exitProfit = finite(raw.exitProfit) ?? legacyProfit
  const exitLoss = finite(raw.exitLoss) ?? legacyLoss
  return {
    ...(exitProfit != null && exitProfit > 0 ? { exitProfit } : {}),
    ...(exitLoss != null && exitLoss !== 0 ? { exitLoss: Math.abs(exitLoss) } : {}),
    maxTradeCycle: clampInt(raw.maxTradeCycle, 1, 1000, base.maxTradeCycle),
    noTradeAfter:
      typeof raw.noTradeAfter === 'string' && HHMM_RE.test(raw.noTradeAfter) ? raw.noTradeAfter : base.noTradeAfter,
    profitTrailing: {
      type: trailingType,
      ...(needsLock && finite(t.ifProfitReaches) != null ? { ifProfitReaches: finite(t.ifProfitReaches)! } : {}),
      ...(needsLock && finite(t.lockProfitAt) != null ? { lockProfitAt: finite(t.lockProfitAt)! } : {}),
      ...(needsTrail && finite(t.onEveryIncreaseOf) != null ? { onEveryIncreaseOf: finite(t.onEveryIncreaseOf)! } : {}),
      ...(needsTrail && finite(t.trailProfitBy) != null ? { trailProfitBy: finite(t.trailProfitBy)! } : {}),
    },
  }
}

/** Which trailing fields a given mode requires — shared by FE + BE validation. */
export function requiredTrailingFields(type: ProfitTrailingType): (keyof ProfitTrailingConfig)[] {
  switch (type) {
    case 'LOCK_FIX_PROFIT':
      return ['ifProfitReaches', 'lockProfitAt']
    case 'TRAIL_PROFIT':
      return ['onEveryIncreaseOf', 'trailProfitBy']
    case 'LOCK_AND_TRAIL':
      return ['ifProfitReaches', 'lockProfitAt', 'onEveryIncreaseOf', 'trailProfitBy']
    default:
      return []
  }
}

export const TRAILING_FIELD_LABELS: Record<string, string> = {
  ifProfitReaches: 'If profit reaches',
  lockProfitAt: 'Lock profit at',
  onEveryIncreaseOf: 'On every increase of',
  trailProfitBy: 'Trail profit by',
}

/**
 * Validate the Order Type block. Shared verbatim by the builder (live form
 * feedback) and `validateStrategyRules` (server-side enforcement), so the two
 * can never drift.
 */
export function validateOrderTypeConfig(cfg: OrderTypeConfig | undefined): string[] {
  const errors: string[] = []
  if (cfg == null) return errors // absent block = legacy strategy, defaults apply
  if (!(ORDER_TYPE_KINDS as readonly string[]).includes(cfg.type)) {
    errors.push(`orderType.type must be one of ${ORDER_TYPE_KINDS.join('/')}`)
    return errors
  }
  if (!HHMM_RE.test(cfg.startTime ?? '')) errors.push('orderType.startTime must be a valid HH:mm time')

  if (cfg.type === 'BTST') {
    if (!HHMM_RE.test(cfg.nextDaySquareOffTime ?? '')) {
      errors.push('orderType.nextDaySquareOffTime must be a valid HH:mm time for BTST orders')
    }
  } else {
    if (!HHMM_RE.test(cfg.squareOffTime ?? '')) {
      errors.push('orderType.squareOffTime must be a valid HH:mm time')
    } else if (HHMM_RE.test(cfg.startTime ?? '') && cfg.startTime >= (cfg.squareOffTime ?? '')) {
      errors.push('orderType.startTime must be before orderType.squareOffTime')
    }
  }

  if (!Array.isArray(cfg.tradingDays) || cfg.tradingDays.length === 0) {
    errors.push('orderType.tradingDays must contain at least one trading day')
  } else {
    const invalid = cfg.tradingDays.filter((d) => !(TRADING_DAYS as readonly string[]).includes(d))
    if (invalid.length > 0) errors.push(`orderType.tradingDays contains unsupported day(s): ${invalid.join(', ')}`)
    if (new Set(cfg.tradingDays).size !== cfg.tradingDays.length) errors.push('orderType.tradingDays contains duplicates')
  }

  if (cfg.type === 'CNC') {
    const cnc = cfg.cnc
    if (cnc == null) {
      errors.push('orderType.cnc settings are required when CNC is selected')
    } else {
      for (const key of ['entryDaysBeforeExpiry', 'exitDaysBeforeExpiry'] as const) {
        const v = finite(cnc[key])
        if (v == null || !Number.isInteger(v) || v < CNC_DAYS_MIN || v > CNC_DAYS_MAX) {
          errors.push(`orderType.cnc.${key} must be an integer between ${CNC_DAYS_MIN} and ${CNC_DAYS_MAX}`)
        }
      }
    }
  } else if (cfg.cnc != null) {
    errors.push('orderType.cnc settings are only allowed when CNC is selected')
  }

  return errors
}

/** Validate the Risk Management block (shared FE + BE). */
export function validateRiskManagementConfig(cfg: RiskManagementConfig | undefined): string[] {
  const errors: string[] = []
  if (cfg == null) return errors // absent block = legacy strategy, defaults apply

  const profit = finite(cfg.exitProfit)
  if (cfg.exitProfit != null && cfg.exitProfit !== ('' as unknown) && !(profit != null && profit > 0)) {
    errors.push('riskManagement.exitProfit must be a positive INR amount')
  }
  const loss = finite(cfg.exitLoss)
  if (cfg.exitLoss != null && cfg.exitLoss !== ('' as unknown) && !(loss != null && loss !== 0)) {
    errors.push('riskManagement.exitLoss must be a valid INR amount')
  }

  const cycles = finite(cfg.maxTradeCycle)
  if (cycles == null || !Number.isInteger(cycles) || cycles < 1) {
    errors.push('riskManagement.maxTradeCycle must be a positive integer')
  }

  if (!HHMM_RE.test(cfg.noTradeAfter ?? '')) {
    errors.push('riskManagement.noTradeAfter must be a valid HH:mm time')
  }

  const trailing = cfg.profitTrailing
  if (trailing == null || !(PROFIT_TRAILING_TYPES as readonly string[]).includes(trailing.type)) {
    errors.push(`riskManagement.profitTrailing.type must be one of ${PROFIT_TRAILING_TYPES.join('/')}`)
    return errors
  }
  // Trailing fields are required ONLY for the selected mode.
  for (const field of requiredTrailingFields(trailing.type)) {
    const v = finite(trailing[field])
    if (v == null || v <= 0) {
      errors.push(`riskManagement.profitTrailing.${field} (${TRAILING_FIELD_LABELS[field]}) must be a positive INR amount`)
    }
  }
  if (trailing.type === 'LOCK_FIX_PROFIT' || trailing.type === 'LOCK_AND_TRAIL') {
    const reach = finite(trailing.ifProfitReaches)
    const lock = finite(trailing.lockProfitAt)
    if (reach != null && lock != null && lock > reach) {
      errors.push('riskManagement.profitTrailing.lockProfitAt cannot exceed ifProfitReaches')
    }
  }
  return errors
}

// ── Defaults for the builder ─────────────────────────────────────────────────

export function defaultRules(): StrategyRules {
  return {
    version: RULE_SCHEMA_VERSION,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: { combinator: 'and', conditions: [] },
    exit: {
      // Do not seed stopLoss with value 0 — validation requires value > 0
      // when the field is present. The builder maps Exit Loss (INR) / leg SL
      // into a real stopLoss; time square-off alone is a valid exit.
      timeSquareOff: { time: '15:20' },
    },
    risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 5 },
    orderType: defaultOrderType('MIS'),
    riskManagement: defaultRiskManagement(),
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
  if (!Array.isArray(conditions)) {
    errors.push('entryConditions.conditions must be an array')
  }
  conditions.forEach((c, i) => {
    const path = `condition ${i + 1}`
    if (!OPERATOR_KEYS.includes(c?.operator)) errors.push(`${path}: invalid operator '${String(c?.operator)}'`)
    validateOperand(c?.left, `${path} (left)`, errors, false)
    validateOperand(c?.right, `${path} (right)`, errors, true)
  })

  // Split long/short entry groups (optional — used by stocks-futures & option-indicator)
  const validateGroup = (g: ConditionGroup | undefined, name: string) => {
    if (g == null) return
    if (g.combinator !== 'and' && g.combinator !== 'or') errors.push(`${name}.combinator must be 'and' or 'or'`)
    if (!Array.isArray(g.conditions)) {
      errors.push(`${name}.conditions must be an array`)
      return
    }
    g.conditions.forEach((c, i) => {
      const path = `${name} condition ${i + 1}`
      if (!OPERATOR_KEYS.includes(c?.operator)) errors.push(`${path}: invalid operator '${String(c?.operator)}'`)
      validateOperand(c?.left, `${path} (left)`, errors, false)
      validateOperand(c?.right, `${path} (right)`, errors, true)
    })
  }
  validateGroup(r.longEntryConditions, 'longEntryConditions')
  validateGroup(r.shortEntryConditions, 'shortEntryConditions')

  // Option strategy legs (optional — option-indicator & option-time)
  const legs = r.legs
  if (legs != null) {
    if (!Array.isArray(legs)) errors.push('legs must be an array')
    else if (legs.length === 0) errors.push('at least one strategy leg is required when legs are provided')
    else
      legs.forEach((leg, i) => {
        const p = `leg ${i + 1}`
        if (leg.condition !== 'LONG' && leg.condition !== 'SHORT') errors.push(`${p}: condition must be LONG or SHORT`)
        if (leg.entryTime != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(leg.entryTime)) {
          errors.push(`${p}: entryTime must be HH:mm (24h, IST)`)
        }
        if (leg.position !== 'BUY' && leg.position !== 'SELL') errors.push(`${p}: position must be BUY or SELL`)
        if (leg.optionType !== 'CALL' && leg.optionType !== 'PUT') errors.push(`${p}: optionType must be CALL or PUT`)
        if (leg.expiry !== 'WEEKLY' && leg.expiry !== 'MONTHLY') errors.push(`${p}: expiry must be WEEKLY or MONTHLY`)
        if (!Number.isInteger(leg.qty) || leg.qty < 1) errors.push(`${p}: qty must be a positive integer`)
      })

    // Option strategies need at least a leg or an entry condition to be actionable.
    if (conditions.length === 0 && legs.length === 0) {
      errors.push('at least one entry condition or strategy leg is required')
    }
  } else if (conditions.length === 0) {
    errors.push('at least one entry condition is required')
  }

  const ex = r.exit ?? {}
  // Coerce HTML/JSON numeric strings ("1000") so validation matches what the
  // user typed. A 0 / empty stopLoss is treated as "not configured" — the
  // builder used to default slValue to 0 while the visible Exit Loss (INR)
  // and per-leg SL fields lived on different state keys.
  const asFinite = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return undefined
  }
  const slValue = asFinite(ex.stopLoss?.value)
  const hasStopLoss = slValue != null && slValue > 0
  if (ex.stopLoss && hasStopLoss) {
    if (!['points', 'percent', 'atr'].includes(ex.stopLoss.type)) errors.push('exit.stopLoss.type invalid')
    if (ex.stopLoss.type === 'percent' && slValue > 100) errors.push('exit.stopLoss percent must be ≤ 100')
    if (ex.stopLoss.type === 'atr' && ex.stopLoss.atrPeriod != null && Number(ex.stopLoss.atrPeriod) < 1) {
      errors.push('exit.stopLoss.atrPeriod must be ≥ 1')
    }
  } else if (ex.stopLoss && slValue != null && slValue < 0) {
    errors.push('exit.stopLoss.value must be > 0')
  }
  const tgtValue = asFinite(ex.target?.value)
  const hasTarget = tgtValue != null && tgtValue > 0
  if (ex.target && hasTarget) {
    if (!['points', 'percent', 'rr_multiple'].includes(ex.target.type)) errors.push('exit.target.type invalid')
    if (ex.target.type === 'rr_multiple' && !hasStopLoss) {
      errors.push('exit.target (risk × reward) requires a stop loss to measure risk against')
    }
  } else if (ex.target && tgtValue != null && tgtValue < 0) {
    errors.push('exit.target.value must be > 0')
  }
  const trailValue = asFinite(ex.trailingStopLoss?.value)
  const hasTrail = trailValue != null && trailValue > 0
  if (ex.trailingStopLoss && hasTrail) {
    if (!['points', 'percent'].includes(ex.trailingStopLoss.type)) errors.push('exit.trailingStopLoss.type invalid')
  } else if (ex.trailingStopLoss && trailValue != null && trailValue < 0) {
    errors.push('exit.trailingStopLoss.value must be > 0')
  }
  if (ex.timeSquareOff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ex.timeSquareOff.time)) {
    errors.push('exit.timeSquareOff.time must be HH:mm (24h, IST)')
  }
  if (ex.maxHoldingBars != null && (!Number.isInteger(ex.maxHoldingBars) || ex.maxHoldingBars < 1)) {
    errors.push('exit.maxHoldingBars must be a positive integer')
  }
  const overallProfit = asFinite(ex.overallProfitAmount)
  if (ex.overallProfitAmount != null && !(overallProfit != null && overallProfit > 0)) {
    errors.push('exit.overallProfitAmount must be > 0')
  }
  const overallLoss = asFinite(ex.overallLossAmount)
  if (ex.overallLossAmount != null && !(overallLoss != null && overallLoss > 0)) {
    errors.push('exit.overallLossAmount must be > 0')
  }
  if (!hasStopLoss && !hasTarget && !ex.timeSquareOff && !ex.maxHoldingBars && !hasTrail) {
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

  // Order Type + Risk Management blocks. Both are optional so strategies saved
  // before the feature shipped keep validating; when present they must be sound.
  errors.push(...validateOrderTypeConfig(r.orderType))
  errors.push(...validateRiskManagementConfig(r.riskManagement))

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
  if (ex.stopLoss && Number(ex.stopLoss.value) > 0) {
    lines.push(`Stop loss: ${ex.stopLoss.value} ${ex.stopLoss.type === 'percent' ? '%' : ex.stopLoss.type === 'atr' ? '× ATR' : 'pts'}`)
  }
  if (ex.target && Number(ex.target.value) > 0) {
    lines.push(`Target: ${ex.target.value} ${ex.target.type === 'percent' ? '%' : ex.target.type === 'rr_multiple' ? '× risk (R:R)' : 'pts'}`)
  }
  if (ex.trailingStopLoss && Number(ex.trailingStopLoss.value) > 0) {
    lines.push(`Trailing SL: ${ex.trailingStopLoss.value} ${ex.trailingStopLoss.type === 'percent' ? '%' : 'pts'}`)
  }
  if (ex.overallProfitAmount != null && Number(ex.overallProfitAmount) > 0) {
    lines.push(`Exit when overall profit: ₹${ex.overallProfitAmount}`)
  }
  if (ex.overallLossAmount != null && Number(ex.overallLossAmount) > 0) {
    lines.push(`Exit when overall loss: ₹${ex.overallLossAmount}`)
  }
  if (ex.timeSquareOff) lines.push(`Time square-off: ${ex.timeSquareOff.time} IST`)
  if (ex.maxHoldingBars) lines.push(`Max holding: ${ex.maxHoldingBars} candles`)
  lines.push(`Qty: ${r.risk.quantity} · Max positions: ${r.risk.maxConcurrentPositions} · Max trades/day: ${r.risk.maxTradesPerDay}${r.risk.capitalAllocationPercent ? ` · Capital: ${r.risk.capitalAllocationPercent}%` : ''}`)
  const ot = r.orderType
  if (ot) {
    const window = ot.type === 'BTST' ? `next-day square off ${ot.nextDaySquareOffTime}` : `square off ${ot.squareOffTime}`
    lines.push(`Order type: ${ot.type} · start ${ot.startTime} · ${window} · ${ot.tradingDays.join(', ')}`)
    if (ot.type === 'CNC' && ot.cnc) {
      lines.push(`CNC window: entry ${ot.cnc.entryDaysBeforeExpiry} / exit ${ot.cnc.exitDaysBeforeExpiry} trading days before expiry`)
    }
  }
  const rm = r.riskManagement
  if (rm) {
    const parts: string[] = []
    if (rm.exitProfit != null) parts.push(`exit profit ₹${rm.exitProfit}`)
    if (rm.exitLoss != null) parts.push(`exit loss ₹${rm.exitLoss}`)
    parts.push(`max ${rm.maxTradeCycle} cycle(s)`)
    parts.push(`no trade after ${rm.noTradeAfter}`)
    lines.push(`Risk management: ${parts.join(' · ')}`)
    const t = rm.profitTrailing
    if (t && t.type !== 'NO_TRAILING') {
      const detail = requiredTrailingFields(t.type)
        .map((f) => `${TRAILING_FIELD_LABELS[f]} ₹${t[f] ?? '—'}`)
        .join(' · ')
      lines.push(`Profit trailing: ${t.type.replace(/_/g, ' ').toLowerCase()} — ${detail}`)
    }
  }
  ;(r.legs ?? []).forEach((leg) => {
    const action = `${leg.position === 'BUY' ? 'BUY' : 'SELL'} ${leg.optionType === 'CALL' ? 'CE' : 'PE'} @ ${leg.strikeType}`
    lines.push(`Leg ${leg.legNumber} (${leg.condition})${leg.entryTime ? ` at ${leg.entryTime}` : ''}: ${action} qty ${leg.qty}${leg.active ? '' : ' (inactive)'}`)
  })
  return lines
}
