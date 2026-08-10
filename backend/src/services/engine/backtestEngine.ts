import type { StrategyRules } from '@algo/rule-schema'
import { indicatorInstanceId } from '@algo/rule-schema'
import type { Candle } from '../brokers/types'
import { IndicatorRuntime, collectIndicatorSpecs, hhmmToMinutes, istDayKey, istMinutesOfDay } from './indicatorEngine'
import { evaluateEntrySignal } from './ruleEvaluator'

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
  exitReason: 'stop_loss' | 'trailing_stop' | 'target' | 'time_squareoff' | 'max_holding' | 'end_of_data'
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
  const runtime = new IndicatorRuntime(collectIndicatorSpecs(rules))
  const timeSqMinutes = rules.exit.timeSquareOff ? hhmmToMinutes(rules.exit.timeSquareOff.time) : null

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
      exitReason: reason,
      barsHeld: position.barsHeld,
    })
    position = null
  }

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    runtime.update(candle)
    const frame = { current: candle, previous: i > 0 ? candles[i - 1] : undefined, runtime }

    // ── Manage open position ──
    if (position) {
      position.barsHeld++
      barsInPosition++

      const cutoffHit = timeSqMinutes != null && istMinutesOfDay(candle.time) >= timeSqMinutes
      const maxHoldingHit = rules.exit.maxHoldingBars != null && position.barsHeld >= rules.exit.maxHoldingBars

      if (cutoffHit) {
        closePosition(candle, i, candle.close, 'time_squareoff')
      } else if (maxHoldingHit) {
        closePosition(candle, i, candle.close, 'max_holding')
      } else {
        // Exits evaluate against stop/target state as of BAR START (see header).
        let slPrice: number | undefined
        let targetPrice: number | undefined
        let slReason: BacktestTrade['exitReason'] = 'stop_loss'
        if (position.stopLoss != null) {
          const hit = position.side === 'LONG' ? candle.low <= position.stopLoss : candle.high >= position.stopLoss
          if (hit) {
            // Gap-through adjustment: if the open is already beyond the stop, fill at the open.
            slPrice =
              position.side === 'LONG' ? Math.min(position.stopLoss, candle.open) : Math.max(position.stopLoss, candle.open)
            slReason = position.stopLossSource === 'trail' ? 'trailing_stop' : 'stop_loss'
          }
        }
        if (position.target != null) {
          const hit = position.side === 'LONG' ? candle.high >= position.target : candle.low <= position.target
          if (hit) {
            targetPrice = position.side === 'LONG' ? Math.max(position.target, candle.open) : Math.min(position.target, candle.open)
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
        if (position) updateTrailing(position, candle)
      }
    }

    // ── Mark-to-market ──
    const unrealized = position
      ? position.side === 'LONG'
        ? (candle.close - position.entryPrice) * position.quantity
        : (position.entryPrice - candle.close) * position.quantity
      : 0
    const equity = capital + unrealized
    runningPeak = Math.max(runningPeak, equity)
    const drawdown = runningPeak - equity
    equityPoints.push({ t: candle.time.toISOString(), equity: round2(equity), cash: round2(capital) })
    drawdownPoints.push({ t: candle.time.toISOString(), drawdown: round2(drawdown) })
    dailyEquity.set(istDayKey(candle.time), equity)

    // ── Entries (only when flat) ──
    if (!position && evaluateEntrySignal(rules, frame)) {
      const dayKey = istDayKey(candle.time)
      const tradesToday = tradesPerDay.get(dayKey) ?? 0
      const pastCutoff = timeSqMinutes != null && istMinutesOfDay(candle.time) >= timeSqMinutes
      const underTradeLimit = tradesToday < rules.risk.maxTradesPerDay

      if (!pastCutoff && underTradeLimit) {
        const side: 'LONG' | 'SHORT' = rules.direction.side === 'long' ? 'LONG' : 'SHORT'
        const entrySide: 'buy' | 'sell' = side === 'LONG' ? 'buy' : 'sell'
        const fill = slippageAdjust(candle.close, config.slippagePercent, entrySide)

        // Capital-allocation % enforcement (spec §3.4 step 4) — skip if notional exceeds the cap.
        if (rules.risk.capitalAllocationPercent != null) {
          const notional = fill * rules.risk.quantity
          const cap = (capital * rules.risk.capitalAllocationPercent) / 100
          if (notional > cap) {
            skippedSignals++
            continue
          }
        }

        const risk = initialStopAndTarget(rules, fill, runtime, side)
        position = {
          side,
          quantity: rules.risk.quantity,
          entryPrice: fill,
          entryTime: candle.time,
          stopLoss: risk.stopLoss,
          stopLossSource: 'base',
          target: risk.target,
          trailDistance: risk.trailDistance,
          peakPrice: fill, // best favorable price "since entry" starts at the fill itself
          entryFee: feeFor(fill * rules.risk.quantity, config),
          entryBarIndex: i,
          barsHeld: 0,
        }
        tradesPerDay.set(dayKey, tradesToday + 1)
      } else {
        skippedSignals++
      }
    }
  }

  // EoD flush: still-open position closes at last close (spec bookkeeping completeness).
  if (position) {
    closePosition(candles[candles.length - 1], candles.length - 1, candles[candles.length - 1].close, 'end_of_data')
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

  return {
    summary,
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
