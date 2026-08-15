import type { StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import { indicatorInstanceId, normalizeOptionExecution } from '@algo/rule-schema'
import type { Candle, OptionChainData } from '../brokers/types'
import { IndicatorRuntime, collectIndicatorSpecs, hhmmToMinutes, istDayKey, istMinutesOfDay } from './indicatorEngine'
import { evaluateDirectionalEntrySignals, evaluateEntrySignal } from './ruleEvaluator'
import {
  optionDataCandle,
  selectOptionContract,
  synthesizeOptionContract,
} from './optionMarketData'
import { hasTimeTriggeredLegs, legSide, markLegFired, pickScheduledLeg } from './timeTriggers'
import {
  ProfitTrailer,
  buildSessionGates,
  canOpenNewTrade,
  hitOverallLimit,
  isPastNextDaySquareOff,
  isPastSquareOff,
  maxTradeCycleFor,
} from './sessionGates'

/**
 * Bar-by-bar backtest engine (spec §3.5).
 *
 * Execution model (documented for realistic expectations):
 * - Signals evaluate on CLOSED bars only; entry fills at the signal bar's
 *   close (a live engine's market order placed at candle close executes within
 *   a tick of close) with slippage applied adversely.
 * - SL / target / trailing exits fill intra-bar at the trigger price,
 *   gap-adjusted to the open if the market gaps past the trigger. When both
 *   SL and target trigger in the same bar, the STOP is assumed (conservative).
 * - Trailing stops ratchet at BAR END from the bar's high/low: exits on bar N
 *   evaluate against stop state known at bar N's start. Updating the trail
 *   from the current bar before checking its low/high would imply same-bar
 *   establish + trigger of the trailing stop — intra-bar sequencing is
 *   unknowable from OHLC, so the stop established by a bar can only fill on
 *   a LATER bar (and then at the stop price, or the open if gapped through).
 * - One open position per strategy at a time (maxConcurrentPositions > 1 is
 *   honored as a limit check but scale-in is not simulated in engine v1).
 * - Entries evaluate on every closed bar while FLAT — including the bar whose
 *   exit just closed a position (mirrors the step-7 live worker's "flat →
 *   evaluate" loop). Risk gates (daily trade cap, time-square-off cutoff,
 *   capital allocation) still apply, and blocked signals count as skips.
 * - Strategy risk rules enforced: maxTradesPerDay, capitalAllocationPercent
 *   (entries skipped when notional exceeds the cap), no entries at/after the
 *   time-square-off cutoff.
 * - Brokerage: flat ₹/side or %-of-notional per side; slippage % per fill.
 */

export interface BacktestConfig {
  initialCapital: number
  brokerageType: 'flat' | 'percent'
  brokerageValue: number
  /** e.g. 0.05 means 0.05% adverse per fill. */
  slippagePercent: number
}

export interface BacktestTrade {
  side: 'LONG' | 'SHORT'
  quantity: number
  entryTime: string
  exitTime: string
  entryPrice: number
  exitPrice: number
  grossPnl: number
  fees: number
  netPnl: number
  /** Present when the trade used option-premium data. */
  optionContract?: {
    strike: number
    optionType: 'CE' | 'PE'
    expiry: string
    deltaAtEntry: number
    impliedVol: number
    source: 'market' | 'synthetic'
  }
  exitReason:
    | 'stop_loss'
    | 'trailing_stop'
    | 'target'
    | 'time_squareoff'
    | 'expiry_squareoff'
    | 'max_holding'
    | 'end_of_data'
    | 'overall_profit'
    | 'overall_loss'
    | 'profit_trailing'
  barsHeld: number
}

export interface EquityPoint {
  t: string
  equity: number
  cash: number
}

export interface BacktestSummary {
  initialCapital: number
  finalEquity: number
  totalNetPnl: number
  totalReturnPct: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  averageWin: number
  averageLoss: number
  profitFactor: number
  expectancy: number
  largestWin: number
  largestLoss: number
  maxDrawdown: number
  maxDrawdownPct: number
  sharpeDaily: number
  totalFees: number
  skippedSignals: number
  exposurePct: number
  candlesProcessed: number
}

export interface BacktestResult {
  summary: BacktestSummary
  /** Price series used for option legs; lets the UI disclose model risk. */
  optionDataMode: 'not_applicable' | 'market' | 'synthetic' | 'underlying_proxy'
  assumptions: string[]
  equityCurve: EquityPoint[]
  drawdownCurve: { t: string; drawdown: number }[]
  trades: BacktestTrade[]
  /** Per-IST-day rows for the daywise heatmap / daily P&L bar chart / transaction details UI. */
  dailyRows: BacktestDayRow[]
}

export interface BacktestDayRow {
  /** IST calendar day, YYYY-MM-DD. */
  date: string
  /** Trades exited that day. */
  trades: number
  /** Net P&L realized that day (after fees). */
  pnl: number
  /** End-of-day equity (last bar's mark-to-market). */
  equity: number
}

interface Position {
  side: 'LONG' | 'SHORT'
  quantity: number
  entryPrice: number // slipped fill
  entryTime: Date
  stopLoss?: number
  stopLossSource: 'base' | 'trail'
  target?: number
  trailDistance?: number
  peakPrice?: number // best favorable price since entry
  trailReference?: number
  entryFee: number
  entryBarIndex: number
  barsHeld: number
  optionData?: OptionChainData
  /** Last premium close, used only if a real chain has a sparse bar. */
  lastMarkPrice: number
}

const MAX_CURVE_POINTS = 1600

function slippageAdjust(price: number, percent: number, side: 'buy' | 'sell'): number {
  const factor = percent / 100
  return side === 'buy' ? price * (1 + factor) : price * (1 - factor)
}

function feeFor(notional: number, config: BacktestConfig): number {
  return config.brokerageType === 'flat' ? config.brokerageValue : (notional * config.brokerageValue) / 100
}

/**
 * Exit levels at fill time — SHARED by live engine (strategyRuntime) for
 * backtest ↔ live parity. ATR stops read the runtime's current ATR value,
 * exactly as the backtest engine does at entry.
 */
export function initialStopAndTarget(
  rules: StrategyRules,
  fillPrice: number,
  runtime: IndicatorRuntime,
  side: 'LONG' | 'SHORT',
): { stopLoss?: number; target?: number; trailDistance?: number } {
  const dir = side === 'LONG' ? 1 : -1
  let riskDistance: number | undefined
  let stopLoss: number | undefined
  let target: number | undefined
  let trailDistance: number | undefined

  const sl = rules.exit.stopLoss
  if (sl) {
    if (sl.type === 'points') riskDistance = sl.value
    else if (sl.type === 'percent') riskDistance = (fillPrice * sl.value) / 100
    else {
      const specId = indicatorInstanceId('atr', { period: sl.atrPeriod ?? 14 })
      const atrValue = runtime.value(specId, 'value')
      if (Number.isFinite(atrValue)) riskDistance = atrValue * sl.value
    }
    if (riskDistance != null) stopLoss = fillPrice - dir * riskDistance
  }

  const tgt = rules.exit.target
  if (tgt) {
    let distance: number | undefined
    if (tgt.type === 'points') distance = tgt.value
    else if (tgt.type === 'percent') distance = (fillPrice * tgt.value) / 100
    else if (riskDistance != null) distance = riskDistance * tgt.value
    if (distance != null) target = fillPrice + dir * distance
  }

  const trail = rules.exit.trailingStopLoss
  if (trail) {
    trailDistance = trail.type === 'points' ? trail.value : (fillPrice * trail.value) / 100
    if (stopLoss == null) stopLoss = fillPrice - dir * trailDistance
  }
  return { stopLoss, target, trailDistance }
}

/** Ratchet the trailing stop from a completed bar's extremes (called at bar end, after exit checks).
 *  Shared with the live engine (structural parity). Position-shape compatible subset. */
export function updateTrailing(
  position: {
    side: 'LONG' | 'SHORT'
    stopLoss?: number
    stopLossSource?: 'base' | 'trail'
    trailDistance?: number
    peakPrice?: number
  },
  candle: Candle,
): void {
  if (position.trailDistance == null) return
  const dir = position.side === 'LONG' ? 1 : -1
  const favorableNow = position.side === 'LONG' ? candle.high : candle.low
  position.peakPrice =
    position.peakPrice == null
      ? favorableNow
      : position.side === 'LONG'
        ? Math.max(position.peakPrice, favorableNow)
        : Math.min(position.peakPrice, favorableNow)
  const candidate = position.peakPrice - dir * position.trailDistance
  const improves = position.side === 'LONG' ? candidate > (position.stopLoss ?? -Infinity) : candidate < (position.stopLoss ?? Infinity)
  if (improves && candidate * dir < position.peakPrice * dir) {
    position.stopLoss = candidate
    position.stopLossSource = 'trail'
  }
}

function downsample<T>(points: T[], maxPoints = MAX_CURVE_POINTS): T[] {
  if (points.length <= maxPoints) return points
  const stride = Math.ceil(points.length / maxPoints)
  const out: T[] = []
  for (let i = 0; i < points.length; i += stride) out.push(points[i])
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1])
  return out
}

function computeSharpe(dailyEquity: Map<string, number>): number {
  // Daily close-of-day equity → returns; annualized with √252. "Sharpe-like" per spec.
  const days = [...dailyEquity.keys()].sort()
  if (days.length < 3) return 0
  const returns: number[] = []
  let prev: number | undefined
  for (const day of days) {
    const equity = dailyEquity.get(day)!
    if (prev != null && prev !== 0) returns.push((equity - prev) / prev)
    prev = equity
  }
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1)
  const std = Math.sqrt(variance)
  if (std === 0) return 0
  return (mean / std) * Math.sqrt(252)
}

export function runBacktestCore(input: {
  rules: StrategyRules
  candles: Candle[]
  config: BacktestConfig
}): BacktestResult {
  const { rules, candles, config } = input
  const indicatorSpecs = collectIndicatorSpecs(rules)
  const runtime = new IndicatorRuntime(indicatorSpecs)
  const optionExecution = normalizeOptionExecution(rules)
  const expiryBufferMs = optionExecution.expiryBufferMinutes * 60_000
  const optionRuntimes = new Map<
    string,
    { runtime: IndicatorRuntime; previous?: Candle; framePrevious?: Candle; current?: Candle }
  >()
  const hasOptionLegs = (rules.legs?.length ?? 0) > 0
  let sawMarketOptionData = false
  let sawSyntheticOptionData = false
  const timeSqMinutes = rules.exit.timeSquareOff ? hhmmToMinutes(rules.exit.timeSquareOff.time) : null
  // Order Type / Risk Management gates (defaults applied for legacy strategies).
  const gates = buildSessionGates(rules)
  const trailer = new ProfitTrailer(gates.riskManagement)
  /** Realized P&L across the whole run — drives overall profit/loss + trailing. */
  let realizedPnl = 0
  /** Set once an overall limit or the trailing floor books the strategy. */
  let strategyHalted = false

  let capital = config.initialCapital
  let position: Position | null = null
  const trades: BacktestTrade[] = []
  const equityPoints: EquityPoint[] = []
  const drawdownPoints: { t: string; drawdown: number }[] = []
  const dailyEquity = new Map<string, number>()
  let runningPeak = capital
  let skippedSignals = 0
  let barsInPosition = 0
  const tradesPerDay = new Map<string, number>()
  const firedLegs = new Set<string>()

  const updateOptionFrames = (candle: Candle): void => {
    for (const data of candle.optionChains?.values() ?? []) {
      if (data.source === 'market') sawMarketOptionData = true
      else sawSyntheticOptionData = true
      let state = optionRuntimes.get(data.contractId)
      if (!state) {
        state = { runtime: new IndicatorRuntime(indicatorSpecs) }
        optionRuntimes.set(data.contractId, state)
      }
      const premiumCandle = optionDataCandle(candle.time, data)
      state.framePrevious = state.previous
      state.runtime.update(premiumCandle)
      state.current = premiumCandle
      state.previous = premiumCandle
    }
  }

  const optionFrameFor = (data: OptionChainData) => {
    const state = optionRuntimes.get(data.contractId)
    if (!state?.current) return undefined
    return { current: state.current, previous: state.framePrevious, runtime: state.runtime }
  }

  const optionSnapshotForPosition = (candle: Candle, current: Position): OptionChainData | undefined => {
    const entryData = current.optionData
    if (!entryData) return undefined
    const fromChain = candle.optionChains?.get(entryData.contractId)
    if (fromChain) return fromChain
    if (entryData.source !== 'synthetic') return undefined
    return synthesizeOptionContract(candle, {
      strike: entryData.strike,
      optionType: entryData.optionType,
      expiryType: entryData.expiryType,
      expiry: entryData.expiry,
      riskFreeRate: optionExecution.riskFreeRate,
      impliedVolatility: entryData.impliedVol,
    })
  }

  const closePosition = (candle: Candle, barIndex: number, rawExitPrice: number, reason: BacktestTrade['exitReason']): void => {
    if (!position) return
    const exitSide: 'buy' | 'sell' = position.side === 'LONG' ? 'sell' : 'buy'
    const exitPrice = slippageAdjust(rawExitPrice, config.slippagePercent, exitSide)
    const exitFee = feeFor(exitPrice * position.quantity, config)
    const gross =
      position.side === 'LONG'
        ? (exitPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - exitPrice) * position.quantity
    const fees = position.entryFee + exitFee
    const netPnl = gross - fees
    capital += netPnl
    realizedPnl += netPnl
    trades.push({
      side: position.side,
      quantity: position.quantity,
      entryTime: position.entryTime.toISOString(),
      exitTime: candle.time.toISOString(),
      entryPrice: round2(position.entryPrice),
      exitPrice: round2(exitPrice),
      grossPnl: round2(gross),
      fees: round2(fees),
      netPnl: round2(netPnl),
      ...(position.optionData
        ? {
            optionContract: {
              strike: position.optionData.strike,
              optionType: position.optionData.optionType,
              expiry: position.optionData.expiry.toISOString(),
              deltaAtEntry: round4(position.optionData.delta),
              impliedVol: round4(position.optionData.impliedVol),
              source: position.optionData.source,
            },
          }
        : {}),
      exitReason: reason,
      barsHeld: position.barsHeld,
    })
    position = null
  }

  let pnlDayKey = ''

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    runtime.update(candle)
    updateOptionFrames(candle)
    const frame = { current: candle, previous: i > 0 ? candles[i - 1] : undefined, runtime }

    // Overall profit/loss limits, the trailing floor and the halt flag are
    // per-IST-day gates (same scope as the daily trade cap) — reset at rollover.
    const candleDayKey = istDayKey(candle.time)
    if (candleDayKey !== pnlDayKey) {
      pnlDayKey = candleDayKey
      realizedPnl = 0
      strategyHalted = false
      trailer.reset()
    }

    // ── Manage open position ──
    if (position) {
      position.barsHeld++
      barsInPosition++
      const optionSnapshot = optionSnapshotForPosition(candle, position)
      const positionCandle = optionSnapshot
        ? optionDataCandle(candle.time, optionSnapshot)
        : position.optionData
          ? {
              time: candle.time,
              open: position.lastMarkPrice,
              high: position.lastMarkPrice,
              low: position.lastMarkPrice,
              close: position.lastMarkPrice,
              volume: 0,
            }
          : candle
      if (optionSnapshot) position.lastMarkPrice = optionSnapshot.close

      // Order Type square-off: MIS/CNC close same day at the configured time;
      // BTST carries overnight and closes at the next-day square-off time.
      const orderTypeCutoff =
        gates.orderType.type === 'BTST'
          ? isPastNextDaySquareOff(gates, position.entryTime, candle.time)
          : isPastSquareOff(gates, candle.time)
      const cutoffHit =
        orderTypeCutoff || (timeSqMinutes != null && istMinutesOfDay(candle.time) >= timeSqMinutes)
      const expiryBufferHit =
        position.optionData != null &&
        position.optionData.expiry.getTime() - candle.time.getTime() <= expiryBufferMs
      const maxHoldingHit = rules.exit.maxHoldingBars != null && position.barsHeld >= rules.exit.maxHoldingBars

      // Risk Management: overall profit/loss limits and the profit-trailing
      // floor evaluate on the running (realized + unrealized) strategy P&L.
      const openPnl =
        position.side === 'LONG'
          ? (positionCandle.close - position.entryPrice) * position.quantity
          : (position.entryPrice - positionCandle.close) * position.quantity
      const runningPnl = realizedPnl + openPnl
      const overallHit = hitOverallLimit(gates.riskManagement, runningPnl)
      const trailingHit = trailer.shouldBook(runningPnl)

      if (overallHit === 'profit') {
        closePosition(candle, i, positionCandle.close, 'overall_profit')
        strategyHalted = true
      } else if (overallHit === 'loss') {
        closePosition(candle, i, positionCandle.close, 'overall_loss')
        strategyHalted = true
      } else if (trailingHit) {
        closePosition(candle, i, positionCandle.close, 'profit_trailing')
        strategyHalted = true
      } else if (expiryBufferHit) {
        closePosition(candle, i, positionCandle.close, 'expiry_squareoff')
      } else if (cutoffHit) {
        closePosition(candle, i, positionCandle.close, 'time_squareoff')
      } else if (maxHoldingHit) {
        closePosition(candle, i, positionCandle.close, 'max_holding')
      } else {
        // Exits evaluate against stop/target state as of BAR START (see header).
        let slPrice: number | undefined
        let targetPrice: number | undefined
        let slReason: BacktestTrade['exitReason'] = 'stop_loss'
        if (position.stopLoss != null) {
          const hit =
            position.side === 'LONG'
              ? positionCandle.low <= position.stopLoss
              : positionCandle.high >= position.stopLoss
          if (hit) {
            // Gap-through adjustment: if the open is already beyond the stop, fill at the open.
            slPrice =
              position.side === 'LONG'
                ? Math.min(position.stopLoss, positionCandle.open)
                : Math.max(position.stopLoss, positionCandle.open)
            slReason = position.stopLossSource === 'trail' ? 'trailing_stop' : 'stop_loss'
          }
        }
        if (position.target != null) {
          const hit =
            position.side === 'LONG'
              ? positionCandle.high >= position.target
              : positionCandle.low <= position.target
          if (hit) {
            targetPrice =
              position.side === 'LONG'
                ? Math.max(position.target, positionCandle.open)
                : Math.min(position.target, positionCandle.open)
          }
        }
        if (slPrice != null && targetPrice != null) {
          closePosition(candle, i, slPrice, slReason) // both in one bar → assume stop (conservative)
        } else if (slPrice != null) {
          closePosition(candle, i, slPrice, slReason)
        } else if (targetPrice != null) {
          closePosition(candle, i, targetPrice, 'target')
        }

        // Bar-end trail ratchet for the still-open position.
        if (position) updateTrailing(position, positionCandle)
      }
    }

    // ── Mark-to-market ──
    const markSnapshot = position ? optionSnapshotForPosition(candle, position) : undefined
    const markPrice = position?.optionData ? markSnapshot?.close ?? position.lastMarkPrice : candle.close
    if (position && markSnapshot) position.lastMarkPrice = markSnapshot.close
    const unrealized = position
      ? position.side === 'LONG'
        ? (markPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - markPrice) * position.quantity
      : 0
    const equity = capital + unrealized
    runningPeak = Math.max(runningPeak, equity)
    const drawdown = runningPeak - equity
    equityPoints.push({ t: candle.time.toISOString(), equity: round2(equity), cash: round2(capital) })
    drawdownPoints.push({ t: candle.time.toISOString(), drawdown: round2(drawdown) })
    dailyEquity.set(istDayKey(candle.time), equity)

    // ── Entries (only when flat, and only while the strategy is live) ──
    if (!position && !strategyHalted) {
      const dayKey = istDayKey(candle.time)
      const tradesToday = tradesPerDay.get(dayKey) ?? 0
      const pastCutoff =
        (timeSqMinutes != null && istMinutesOfDay(candle.time) >= timeSqMinutes) ||
        // Order Type session window + allowed trading days, and the Risk
        // Management "No Trade After" cutoff.
        !canOpenNewTrade(gates, candle.time)
      // Max Trade Cycle caps entry→exit cycles per day alongside
      // maxTradesPerDay — only when the strategy actually configured it.
      const configuredCycle = maxTradeCycleFor(gates)
      const cycleLimit =
        configuredCycle != null ? Math.min(rules.risk.maxTradesPerDay, configuredCycle) : rules.risk.maxTradesPerDay
      const underTradeLimit = tradesToday < cycleLimit

      // Resolve this bar's entry intent:
      //   - time-triggered legs (option-time) → schedule by leg.entryTime;
      //   - option-indicator legs → evaluate each leg's LONG/SHORT group on its
      //     selected premium series;
      //   - no legs (stocks/futures) → evaluate split directional groups.
      let trigger: {
        side: 'LONG' | 'SHORT'
        qty: number
        priceCandle: Candle
        riskRuntime: IndicatorRuntime
        optionData?: OptionChainData
      } | null = null
      let firedLeg: StrategyRuleLeg | undefined
      const hasOptionChain = (candle.optionChains?.size ?? 0) > 0

      if (hasTimeTriggeredLegs(rules.legs)) {
        const leg = pickScheduledLeg(rules.legs, candle, firedLegs)
        if (leg) {
          const optionData = selectOptionContract(candle, leg)
          const optionFrame = optionData ? optionFrameFor(optionData) : undefined
          // Legacy fallback remains available for direct core callers that have
          // no chain at all. Production option runs are enriched by the service.
          if (optionData && optionFrame) {
            trigger = {
              side: legSide(leg),
              qty: leg.qty,
              priceCandle: optionFrame.current,
              riskRuntime: optionFrame.runtime,
              optionData,
            }
            firedLeg = leg
          } else if (!hasOptionChain) {
            trigger = { side: legSide(leg), qty: leg.qty, priceCandle: candle, riskRuntime: runtime }
            firedLeg = leg
          }
        }
      } else if (rules.legs?.length) {
        for (const leg of rules.legs.filter((candidate) => candidate.active)) {
          const direction = leg.condition === 'LONG' ? 'long' : 'short'
          const optionData = selectOptionContract(candle, leg)
          const optionFrame = optionData ? optionFrameFor(optionData) : undefined
          if (optionData && optionFrame) {
            if (evaluateEntrySignal(rules, optionFrame, direction)) {
              trigger = {
                side: legSide(leg),
                qty: leg.qty,
                priceCandle: optionFrame.current,
                riskRuntime: optionFrame.runtime,
                optionData,
              }
              break
            }
          } else if (!hasOptionChain && evaluateEntrySignal(rules, frame, direction)) {
            trigger = { side: legSide(leg), qty: leg.qty, priceCandle: candle, riskRuntime: runtime }
            break
          }
        }
      } else {
        const signal = evaluateDirectionalEntrySignals(rules, frame)[0]
        if (signal) {
          trigger = {
            side: signal === 'long' ? 'LONG' : 'SHORT',
            qty: rules.risk.quantity,
            priceCandle: candle,
            riskRuntime: runtime,
          }
        }
      }

      const optionPastBuffer =
        trigger?.optionData != null &&
        trigger.optionData.expiry.getTime() - candle.time.getTime() <= expiryBufferMs
      const deltaBlocked =
        trigger?.optionData != null &&
        optionExecution.minAbsDelta != null &&
        Math.abs(trigger.optionData.delta) < optionExecution.minAbsDelta
      const entryBlocked = pastCutoff || optionPastBuffer || deltaBlocked

      if (trigger && !entryBlocked && underTradeLimit) {
        const entrySide: 'buy' | 'sell' = trigger.side === 'LONG' ? 'buy' : 'sell'
        const fill = slippageAdjust(trigger.priceCandle.close, config.slippagePercent, entrySide)

        // Capital-allocation % enforcement (spec §3.4 step 4) — skip if notional exceeds the cap.
        if (rules.risk.capitalAllocationPercent != null) {
          const notional = fill * trigger.qty
          const cap = (capital * rules.risk.capitalAllocationPercent) / 100
          if (notional > cap) {
            skippedSignals++
            continue
          }
        }

        const risk = initialStopAndTarget(rules, fill, trigger.riskRuntime, trigger.side)
        position = {
          side: trigger.side,
          quantity: trigger.qty,
          entryPrice: fill,
          entryTime: candle.time,
          stopLoss: risk.stopLoss,
          stopLossSource: 'base',
          target: risk.target,
          trailDistance: risk.trailDistance,
          peakPrice: fill, // best favorable price "since entry" starts at the fill itself
          entryFee: feeFor(fill * trigger.qty, config),
          entryBarIndex: i,
          barsHeld: 0,
          optionData: trigger.optionData,
          lastMarkPrice: trigger.priceCandle.close,
        }
        if (firedLeg) markLegFired(firedLeg, candle, firedLegs)
        tradesPerDay.set(dayKey, tradesToday + 1)
      } else if (trigger && (entryBlocked || !underTradeLimit)) {
        skippedSignals++
      }
    }
  }

  // EoD flush: still-open position closes at the final premium/underlying close.
  if (position && candles.length > 0) {
    const last = candles[candles.length - 1]
    const optionSnapshot = optionSnapshotForPosition(last, position)
    const exitPrice = position.optionData ? optionSnapshot?.close ?? position.lastMarkPrice : last.close
    closePosition(last, candles.length - 1, exitPrice, 'end_of_data')
  }

  // ── Summary stats ──
  const wins = trades.filter((t) => t.netPnl > 0)
  const losses = trades.filter((t) => t.netPnl <= 0)
  const totalNet = trades.reduce((a, t) => a + t.netPnl, 0)
  const totalGrossWins = wins.reduce((a, t) => a + t.netPnl, 0)
  const totalGrossLosses = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0))
  const maxDd = drawdownPoints.reduce((a, p) => Math.max(a, p.drawdown), 0)
  const finalEquity = equityPoints.length ? equityPoints[equityPoints.length - 1].equity : config.initialCapital

  const summary: BacktestSummary = {
    initialCapital: round2(config.initialCapital),
    finalEquity: round2(finalEquity),
    totalNetPnl: round2(totalNet),
    totalReturnPct: config.initialCapital > 0 ? round2((totalNet / config.initialCapital) * 100) : 0,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round2((wins.length / trades.length) * 100) : 0,
    averageWin: wins.length ? round2(totalGrossWins / wins.length) : 0,
    averageLoss: losses.length ? round2(totalGrossLosses / losses.length) : 0,
    profitFactor: totalGrossLosses > 0 ? round2(totalGrossWins / totalGrossLosses) : wins.length > 0 ? Infinity : 0,
    expectancy: trades.length ? round2(totalNet / trades.length) : 0,
    largestWin: wins.length ? round2(Math.max(...wins.map((t) => t.netPnl))) : 0,
    largestLoss: losses.length ? round2(Math.min(...losses.map((t) => t.netPnl))) : 0,
    maxDrawdown: round2(maxDd),
    maxDrawdownPct: runningPeak > 0 ? round2((maxDd / runningPeak) * 100) : 0,
    sharpeDaily: round2(computeSharpe(dailyEquity)),
    totalFees: round2(trades.reduce((a, t) => a + t.fees, 0)),
    skippedSignals,
    exposurePct: candles.length ? round2((barsInPosition / candles.length) * 100) : 0,
    candlesProcessed: candles.length,
  }

  const optionDataMode: BacktestResult['optionDataMode'] = !hasOptionLegs
    ? 'not_applicable'
    : sawSyntheticOptionData
      ? 'synthetic'
      : sawMarketOptionData
        ? 'market'
        : 'underlying_proxy'
  const assumptions: string[] = []
  if (optionDataMode === 'synthetic') {
    assumptions.push(
      `Historical option premiums were synthesized with Black–Scholes (IV ${(optionExecution.impliedVolatility * 100).toFixed(2)}%, risk-free rate ${(optionExecution.riskFreeRate * 100).toFixed(2)}%).`,
      'Synthetic premiums do not model bid/ask spreads, liquidity, IV skew, discrete dividends, or exchange-holiday expiry adjustments.',
    )
  } else if (optionDataMode === 'underlying_proxy') {
    assumptions.push('No option chain was supplied; option legs used the legacy underlying-price proxy.')
  }
  if (hasOptionLegs && optionExecution.minAbsDelta != null) {
    assumptions.push(`Entries required absolute delta >= ${optionExecution.minAbsDelta}.`)
  }
  if (hasOptionLegs) assumptions.push(`Positions were closed ${optionExecution.expiryBufferMinutes} minutes before expiry.`)

  return {
    summary,
    optionDataMode,
    assumptions,
    equityCurve: downsample(equityPoints),
    drawdownCurve: downsample(drawdownPoints),
    trades,
    dailyRows: buildDailyRows(trades, dailyEquity),
  }
}

/** Per-day P&L (from trades grouped by IST exit day) + end-of-day equity for every traded/tracked day. */
function buildDailyRows(trades: BacktestTrade[], dailyEquity: Map<string, number>): BacktestDayRow[] {
  const byDay = new Map<string, { trades: number; pnl: number }>()
  for (const t of trades) {
    const day = istDayKey(new Date(t.exitTime))
    const agg = byDay.get(day) ?? { trades: 0, pnl: 0 }
    agg.trades += 1
    agg.pnl += t.netPnl
    byDay.set(day, agg)
  }
  return [...dailyEquity.keys()].sort().map((day) => {
    const agg = byDay.get(day) ?? { trades: 0, pnl: 0 }
    return { date: day, trades: agg.trades, pnl: round2(agg.pnl), equity: round2(dailyEquity.get(day)!) }
  })
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000
}
