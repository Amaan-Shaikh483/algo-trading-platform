import type { StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import { validateStrategyRules } from '@algo/rule-schema'
import type { BrokerAdapter, Candle } from '../brokers/types'
import type { PositionRow, StrategyRow } from '../../supabase/types'
import { logger } from '../../lib/logger'
import { notify } from '../userEvents'
import { IndicatorRuntime, collectIndicatorSpecs, hhmmToMinutes, istDayKey, istMinutesOfDay } from '../engine/indicatorEngine'
import { evaluateEntrySignal } from '../engine/ruleEvaluator'
import { hasTimeTriggeredLegs, legSide, markLegFired, pickScheduledLeg } from '../engine/timeTriggers'
import {
  ProfitTrailer,
  buildSessionGates,
  canOpenNewTrade,
  hitOverallLimit,
  isPastNextDaySquareOff,
  isPastSquareOff,
  maxTradeCycleFor,
} from '../engine/sessionGates'
import type { SessionGates } from '../engine/sessionGates'
import { initialStopAndTarget, updateTrailing } from '../engine/backtestEngine'
import { recordClosedTrade } from '../risk/riskManager'
import { bucketStartFor, TIMEFRAME_MINUTES } from './candleAggregator'
import * as ledger from './executionLedger'
import { executeIntent, RouterOutcome } from './orderRouter'
import type { LiveExitReason, LiveTick, PositionRuntimeState } from './liveTypes'

/**
 * Strategy runtime (spec §3.6) — ONE instance per ACTIVE strategy.
 *
 * Parity contract with the backtest engine:
 *   - entries: evaluated on CLOSED candles via the SAME evaluateEntrySignal +
 *     SAME incremental IndicatorRuntime + SAME initialStopAndTarget levels;
 *   - exits: SL / target / trailing monitored at TICK level (finer than the
 *     backtest's OHLC-bar trigger detection — an inherent, documented
 *     live-vs-backtest difference; fill is a real market order, not a
 *     simulated price);
 *   - trailing ratchets at candle close (bar end), same as the backtest;
 *   - strategy risk gates (maxTradesPerDay per IST day, time-square-off,
 *     maxHoldingBars, capitalAllocationPercent) mirror runBacktestCore
 *     (live capital% checks against broker RMS available margin; skipped in
 *     paper mode — paper v1 has no per-user simulated capital).
 *
 * Fresh-signal policy: entries evaluate only for candles whose bucket starts
 * AFTER activation (warm-up seeds indicators inertly) — a strategy never
 * fires on a stale candle. Exits resume for an already-open position from
 * persisted runtime_state — position safety outranks signal freshness.
 */

const WARMUP_CANDLES = 200
const EXIT_RETRY_BACKOFF_MS = 60_000

export interface RuntimeDeps {
  adapterFor: (userId: string) => Promise<BrokerAdapter>
  /** Recent-candle fetch for warm-up / post-reconnect catch-up. */
  candlesFor: (userId: string, exchange: string, token: string, interval: string, from: Date, to: Date) => Promise<Candle[]>
  /** RMS available margin for the live capitalAllocation% gate (cached by supervisor). */
  availableMarginFor?: (userId: string) => Promise<number | null>
}

export class StrategyRuntime {
  private readonly indicatorRt: IndicatorRuntime
  private readonly timeSqMinutes: number | null
  private readonly timeframeMinutes: number
  private position: PositionRow | null = null
  private positionState: PositionRuntimeState | null = null
  private previousCandle: Candle | undefined
  private inflight = false
  private tradesToday = 0
  private tradesDayKey = ''
  private lastClosedBucketMs = 0
  private firstLiveBucketMs = 0
  private exitRetryNotBefore = 0
  private pendingExitReason: LiveExitReason | null = null
  private stopped = false
  private firedLegs = new Set<string>()
  /** Order Type + Risk Management gates (defaults applied for legacy strategies). */
  private readonly gates: SessionGates
  private readonly trailer: ProfitTrailer
  /** Realized P&L for the current IST day — drives overall limits + trailing. */
  private realizedPnlToday = 0
  /** Set once an overall limit / trailing floor booked the strategy for the day. */
  private haltedForDay = false

  private constructor(
    private readonly strategy: StrategyRow,
    private readonly rules: StrategyRules,
    private readonly deps: RuntimeDeps,
  ) {
    this.indicatorRt = new IndicatorRuntime(collectIndicatorSpecs(rules))
    this.timeSqMinutes = rules.exit.timeSquareOff ? hhmmToMinutes(rules.exit.timeSquareOff.time) : null
    this.timeframeMinutes = TIMEFRAME_MINUTES[strategy.timeframe] ?? 1
    this.gates = buildSessionGates(rules)
    this.trailer = new ProfitTrailer(this.gates.riskManagement)
  }

  get id(): string {
    return this.strategy.id
  }
  get userId(): string {
    return this.strategy.user_id
  }
  get symbolToken(): string {
    return this.strategy.symbol_token
  }
  get exchange(): string {
    return this.strategy.exchange
  }
  get timeframe(): string {
    return this.strategy.timeframe
  }
  get mode(): 'paper' | 'live' {
    return this.strategy.mode
  }
  get name(): string {
    return this.strategy.name
  }
  get awaitingSettlement(): boolean {
    return this.inflight
  }

  static async create(strategy: StrategyRow, deps: RuntimeDeps): Promise<StrategyRuntime> {
    const { valid, errors } = validateStrategyRules(strategy.rules)
    if (!valid) throw new Error(`invalid rules for ${strategy.name}: ${errors.join('; ')}`)
    const rt = new StrategyRuntime(strategy, strategy.rules as unknown as StrategyRules, deps)

    // ── Warm-up (inert): seed indicators from recent history, evaluate nothing.
    const activatedMs = Date.now()
    const now = new Date(activatedMs)
    const barMs = rt.timeframeMinutes * 60000
    const from = new Date(activatedMs - WARMUP_CANDLES * barMs * 2.5) // weekend/holiday buffer
    try {
      const candles = await deps.candlesFor(rt.userId, rt.exchange, rt.symbolToken, rt.timeframe, from, now)
      const currentBucket = bucketStartFor(activatedMs, rt.timeframeMinutes)
      for (const c of candles) {
        if (currentBucket != null && c.time.getTime() >= currentBucket) continue // live-forming candle — skip
        rt.indicatorRt.update(c)
        rt.previousCandle = c
        rt.lastClosedBucketMs = Math.max(rt.lastClosedBucketMs, c.time.getTime())
      }
      logger.info('runtime warmed', { strategyId: strategy.id, name: strategy.name, seededCandles: candles.length, timeframe: strategy.timeframe })
    } catch (err) {
      logger.warn('runtime warm-up failed (indicators cold — entries wait for enough live bars)', {
        strategyId: strategy.id,
        error: (err as Error).message,
      })
    }

    // Entries only for buckets fully after activation (never a stale close).
    const activationBucket = bucketStartFor(activatedMs, rt.timeframeMinutes)
    rt.firstLiveBucketMs = activationBucket != null ? activationBucket + barMs : nextSessionFirstBucket(activatedMs, rt.timeframeMinutes)

    // ── Resume open position + today's fill count.
    rt.position = await ledger.getOpenPositionForStrategy(strategy.id)
    if (rt.position) rt.positionState = readState(rt.position)
    rt.tradesDayKey = istDayKey(now)
    const istDayStart = new Date()
    istDayStart.setUTCHours(18, 30, 0, 0) // 00:00 IST == 18:30 UTC previous day
    if (istDayStart.getTime() > Date.now()) istDayStart.setUTCDate(istDayStart.getUTCDate() - 1)
    try {
      rt.tradesToday = await ledger.countFilledEntryOrdersSince(strategy.id, istDayStart.toISOString())
    } catch (err) {
      logger.warn('entry-count warm failed; starting at 0', { strategyId: strategy.id, error: (err as Error).message })
      rt.tradesToday = 0
    }
    return rt
  }

  stop(): void {
    this.stopped = true
    if (this.position && this.positionState) {
      void ledger.updatePositionRuntime(this.position.id, this.positionState)
    }
  }

  // ── Tick path: SL / target (trailing levels already ratcheted at closes) ──

  async onTick(tick: LiveTick): Promise<void> {
    if (this.stopped || this.inflight || !this.position || !this.positionState) return
    const s = this.positionState
    const long = this.position.side === 'LONG'
    if (s.stopLoss != null) {
      const hit = long ? tick.price <= s.stopLoss : tick.price >= s.stopLoss
      if (hit) {
        await this.requestExit(s.stopLossSource === 'trail' ? 'trailing_stop' : 'stop_loss', tick.price)
        return
      }
    }
    if (s.target != null) {
      const hit = long ? tick.price >= s.target : tick.price <= s.target
      if (hit) await this.requestExit('target', tick.price)
    }
  }

  // ── Candle-close path: indicators + time-based exits + trailing + entries ──

  async onCandleClose(candle: Candle): Promise<void> {
    if (this.stopped) return
    const tMs = candle.time.getTime()
    if (tMs <= this.lastClosedBucketMs) return // catch-up replay dedupe
    this.lastClosedBucketMs = tMs
    this.indicatorRt.update(candle)

    const dayKey = istDayKey(candle.time)
    if (dayKey !== this.tradesDayKey) {
      this.tradesDayKey = dayKey
      this.tradesToday = 0
      this.firedLegs = new Set<string>() // fresh time-trigger schedule each IST day
      // Risk Management limits scope to the IST day, same as the trade cap.
      this.realizedPnlToday = 0
      this.haltedForDay = false
      this.trailer.reset()
    }

    // ── Position management (mirror of runBacktestCore's bar handling) ──
    if (this.position && this.positionState && !this.inflight) {
      const s = this.positionState
      s.barsHeld++
      const long = this.position.side === 'LONG'
      // Order Type square-off: MIS/CNC same-day; BTST at the next-day time.
      const orderTypeCutoff =
        this.gates.orderType.type === 'BTST'
          ? isPastNextDaySquareOff(this.gates, new Date(this.position.opened_at), candle.time)
          : isPastSquareOff(this.gates, candle.time)
      const cutoffHit =
        orderTypeCutoff || (this.timeSqMinutes != null && istMinutesOfDay(candle.time) >= this.timeSqMinutes)
      const maxHoldingHit = this.rules.exit.maxHoldingBars != null && s.barsHeld >= this.rules.exit.maxHoldingBars

      // Risk Management: overall profit/loss + profit trailing on running P&L.
      const entryPrice = Number(this.position.average_entry_price)
      const openPnl =
        (long ? candle.close - entryPrice : entryPrice - candle.close) * this.position.quantity
      const runningPnl = this.realizedPnlToday + openPnl
      const overallHit = hitOverallLimit(this.gates.riskManagement, runningPnl)
      const trailingHit = this.trailer.shouldBook(runningPnl)

      if (overallHit === 'profit') {
        this.haltedForDay = true
        await this.requestExit('overall_profit', candle.close)
      } else if (overallHit === 'loss') {
        this.haltedForDay = true
        await this.requestExit('overall_loss', candle.close)
      } else if (trailingHit) {
        this.haltedForDay = true
        await this.requestExit('profit_trailing', candle.close)
      } else if (cutoffHit) {
        await this.requestExit('time_squareoff', candle.close)
      } else if (maxHoldingHit) {
        await this.requestExit('max_holding', candle.close)
      } else {
        // Redundant OHLC sweep — covers a tick-gap between closes.
        if (s.stopLoss != null && (long ? candle.low <= s.stopLoss : candle.high >= s.stopLoss)) {
          await this.requestExit(s.stopLossSource === 'trail' ? 'trailing_stop' : 'stop_loss', candle.close)
        } else if (s.target != null && (long ? candle.high >= s.target : candle.low <= s.target)) {
          await this.requestExit('target', candle.close)
        } else if (s.trailDistance != null) {
          const beforeLevel = s.stopLoss
          const view = {
            side: this.position.side,
            stopLoss: s.stopLoss,
            stopLossSource: s.stopLossSource,
            trailDistance: s.trailDistance,
            peakPrice: s.peakPrice,
          }
          updateTrailing(view, candle)
          s.stopLoss = view.stopLoss
          s.stopLossSource = view.stopLossSource
          s.peakPrice = view.peakPrice
          s.lastCandleTime = candle.time.toISOString()
          if (s.stopLoss !== beforeLevel) void ledger.updatePositionRuntime(this.position.id, s)
        } else {
          s.lastCandleTime = candle.time.toISOString()
        }
      }
    }

    // ── Entries (fresh buckets only, backtest gate ordering preserved) ──
    const fresh = tMs >= this.firstLiveBucketMs
    if (fresh && !this.position && !this.inflight && !this.haltedForDay) {
      const pastCutoff =
        (this.timeSqMinutes != null && istMinutesOfDay(candle.time) >= this.timeSqMinutes) ||
        // Order Type session window + allowed trading days, and the Risk
        // Management "No Trade After" cutoff.
        !canOpenNewTrade(this.gates, candle.time)
      const configuredCycle = maxTradeCycleFor(this.gates)
      const cycleLimit =
        configuredCycle != null
          ? Math.min(this.rules.risk.maxTradesPerDay, configuredCycle)
          : this.rules.risk.maxTradesPerDay
      const underTradeLimit = this.tradesToday < cycleLimit

      // Resolve entry intent (mirrors runBacktestCore): time-triggered legs,
      // leg-defined signal entries, or classic direction-based signal entry.
      let leg: StrategyRuleLeg | undefined
      let shouldEnter = false

      if (hasTimeTriggeredLegs(this.rules.legs)) {
        const scheduled = pickScheduledLeg(this.rules.legs, candle, this.firedLegs)
        if (scheduled) {
          leg = scheduled
          shouldEnter = true
        }
      } else if (this.rules.legs?.length) {
        if (evaluateEntrySignal(this.rules, { current: candle, previous: this.previousCandle, runtime: this.indicatorRt })) {
          leg = this.rules.legs.find((l) => l.active)
          shouldEnter = true
        }
      } else if (evaluateEntrySignal(this.rules, { current: candle, previous: this.previousCandle, runtime: this.indicatorRt })) {
        shouldEnter = true
      }

      if (shouldEnter && !pastCutoff && underTradeLimit) {
        await this.requestEntry(candle, leg)
      }
    }

    this.previousCandle = candle
  }

  /** Post-reconnect catch-up: fetch closes since our last bucket and replay (dedupe inside onCandleClose). */
  async catchUp(): Promise<void> {
    if (this.stopped) return
    const lookbackDays = this.timeframeMinutes >= 375 ? 10 : 2
    const from = new Date(Math.max(this.lastClosedBucketMs - 1, Date.now() - lookbackDays * 86400000))
    try {
      const candles = await this.deps.candlesFor(this.userId, this.exchange, this.symbolToken, this.timeframe, from, new Date())
      for (const c of candles) await this.onCandleClose(c)
    } catch (err) {
      logger.warn('catch-up failed', { strategyId: this.id, error: (err as Error).message })
    }
  }

  /** Reconciliation settles an in-flight order from the broker order book. */
  async notifyOrderSettled(order: { purpose: 'entry' | 'exit'; status: string; average_price: number | null; filled_quantity: number }): Promise<void> {
    this.inflight = false
    if (order.status !== 'complete' || order.average_price == null) {
      // rejected/cancelled while in-flight — resume normal operation.
      return
    }
    if (order.purpose === 'entry' && !this.position) {
      const side = this.rules.direction.side === 'long' ? 'LONG' : 'SHORT'
      const fill = Number(order.average_price)
      const levels = initialStopAndTarget(this.rules, fill, this.indicatorRt, side)
      this.position = await ledger.openPosition({
        userId: this.userId,
        strategyId: this.id,
        symbol: this.strategy.instrument,
        symbolToken: this.symbolToken,
        exchange: this.exchange,
        side,
        quantity: order.filled_quantity || this.rules.risk.quantity,
        entryPrice: fill,
        mode: this.mode,
        runtimeState: toState(levels, { barsHeld: 0, entryTime: new Date().toISOString() }),
      })
      this.positionState = readState(this.position)
      this.tradesToday++
    } else if (order.purpose === 'exit' && this.position) {
      await this.bookExit(this.position, Number(order.average_price), this.pendingExitReason ?? 'strategy_stopped')
      this.pendingExitReason = null
    }
  }

  // ── Internals ──

  private async requestEntry(candle: Candle, leg?: StrategyRuleLeg): Promise<void> {
    this.inflight = true
    const side = leg ? legSide(leg) : this.rules.direction.side === 'long' ? 'LONG' : 'SHORT'
    const quantity = leg ? leg.qty : this.rules.risk.quantity
    const approxPrice = candle.close
    try {
      if (this.mode === 'live' && this.rules.risk.capitalAllocationPercent != null && this.deps.availableMarginFor) {
        const margin = await this.deps.availableMarginFor(this.userId)
        if (margin != null) {
          const cap = (margin * this.rules.risk.capitalAllocationPercent) / 100
          if (approxPrice * quantity > cap) {
            logger.warn('entry skipped: capitalAllocation% cap (RMS)', { strategyId: this.id, cap, notional: approxPrice * quantity })
            this.inflight = false
            return
          }
        }
      }
      const adapter = this.mode === 'live' ? await this.deps.adapterFor(this.userId) : undefined
      const outcome = await executeIntent({
        userId: this.userId,
        strategyId: this.id,
        strategyName: this.name,
        symbol: this.strategy.instrument,
        symbolToken: this.symbolToken,
        exchange: this.exchange,
        side: side === 'LONG' ? 'BUY' : 'SELL',
        quantity,
        approxPrice,
        mode: this.mode,
        purpose: 'entry',
        orderType: this.rules.entry.orderType,
        productType: this.rules.entry.productType,
        clientRef: `${this.id}:entry:${candle.time.getTime()}`,
        ...(adapter ? { liveAdapter: adapter } : {}),
      })
      await this.handleEntryOutcome(outcome, candle, side, quantity)
      if (leg && this.position) markLegFired(leg, candle, this.firedLegs)
    } catch (err) {
      logger.error('entry intent failed', { strategyId: this.id, error: (err as Error).message })
      await notify(this.userId, 'strategy_error', `Strategy runtime error: ${this.name}`, (err as Error).message)
      this.inflight = false
    }
  }

  private async handleEntryOutcome(outcome: RouterOutcome, candle: Candle, side: 'LONG' | 'SHORT', quantity: number): Promise<void> {
    if (outcome.outcome === 'filled') {
      const fill = outcome.fillPrice!
      const levels = initialStopAndTarget(this.rules, fill, this.indicatorRt, side)
      this.position = await ledger.openPosition({
        userId: this.userId,
        strategyId: this.id,
        symbol: this.strategy.instrument,
        symbolToken: this.symbolToken,
        exchange: this.exchange,
        side,
        quantity: outcome.filledQuantity || quantity,
        entryPrice: fill,
        mode: this.mode,
        runtimeState: toState(levels, { barsHeld: 0, entryTime: candle.time.toISOString(), lastCandleTime: candle.time.toISOString() }),
      })
      this.positionState = readState(this.position)
      this.tradesToday++
      this.inflight = false
      logger.info('position opened', { strategyId: this.id, side, fill, mode: this.mode })
      return
    }
    if (outcome.outcome === 'blocked' || outcome.outcome === 'rejected' || outcome.outcome === 'failed') {
      logger.warn('entry not authorized/placed', { strategyId: this.id, outcome: outcome.outcome, reason: outcome.reason })
      this.inflight = false
      return
    }
    // 'placed' — live order accepted but unconfirmed; reconciliation converges and calls notifyOrderSettled.
    logger.info('entry order placed, awaiting fill confirmation', { strategyId: this.id, orderId: outcome.orderId })
  }

  private async requestExit(reason: LiveExitReason, refPrice: number): Promise<void> {
    if (!this.position || this.inflight) return
    if (Date.now() < this.exitRetryNotBefore) return
    this.inflight = true
    this.pendingExitReason = reason
    const position = this.position
    try {
      const adapter = this.mode === 'live' ? await this.deps.adapterFor(this.userId) : undefined
      const outcome = await executeIntent({
        userId: this.userId,
        strategyId: this.id,
        strategyName: this.name,
        symbol: position.symbol,
        symbolToken: position.symbol_token,
        exchange: position.exchange ?? this.exchange,
        side: position.side === 'LONG' ? 'SELL' : 'BUY',
        quantity: position.quantity,
        approxPrice: refPrice,
        mode: position.mode,
        purpose: 'exit',
        orderType: 'MARKET',
        productType: this.rules.entry.productType,
        clientRef: `${position.id}:exit`,
        exitReason: reason,
        ...(adapter ? { liveAdapter: adapter } : {}),
      })
      if (outcome.outcome === 'filled') {
        this.pendingExitReason = null
        await this.bookExit(position, outcome.fillPrice ?? refPrice, reason)
        this.inflight = false
      } else if (outcome.outcome === 'placed') {
        logger.info('exit order placed, awaiting fill confirmation', { strategyId: this.id, orderId: outcome.orderId })
        // inflight stays — reconciliation settles.
      } else {
        logger.warn('exit not placed (will retry)', { strategyId: this.id, outcome: outcome.outcome, reason: outcome.reason })
        await notify(this.userId, 'order_rejected', `Exit ${outcome.outcome}: ${this.name}`, outcome.reason ?? '')
        this.exitRetryNotBefore = Date.now() + EXIT_RETRY_BACKOFF_MS
        this.inflight = false
        this.pendingExitReason = null
      }
    } catch (err) {
      logger.error('exit intent failed (will retry)', { strategyId: this.id, error: (err as Error).message })
      this.exitRetryNotBefore = Date.now() + EXIT_RETRY_BACKOFF_MS
      this.inflight = false
      this.pendingExitReason = null
    }
  }

  /** Position-close bookkeeping: ledger + trade log + risk counter + §3.9 events. */
  private async bookExit(position: PositionRow, exitPrice: number, reason: LiveExitReason): Promise<void> {
    const entryPrice = Number(position.average_entry_price)
    const gross = (position.side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * position.quantity
    const pnl = Math.round(gross * 100) / 100
    this.realizedPnlToday += pnl
    try {
      await ledger.closePosition(position.id, { exitPrice, reason })
    } catch (err) {
      // Already closed (e.g. reconciliation raced us) — skip double-booking.
      logger.warn('position already closed', { positionId: position.id, error: (err as Error).message })
      this.position = null
      this.positionState = null
      return
    }
    await ledger.insertTradeLog({
      userId: this.userId,
      strategyId: this.id,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entryPrice,
      exitPrice,
      pnl,
      mode: position.mode,
      entryTime: position.opened_at,
      exitTime: new Date().toISOString(),
    })
    this.position = null
    this.positionState = null
    logger.info('position closed', { strategyId: this.id, reason, exitPrice, pnl })

    if (position.mode === 'live') {
      const { autoPaused } = await recordClosedTrade(this.userId, pnl)
      if (autoPaused) logger.warn('daily-loss auto-pause fired from exit', { strategyId: this.id })
    }
    const label = this.strategy.instrument
    if (reason === 'stop_loss' || reason === 'trailing_stop') {
      await notify(this.userId, 'sl_hit', `${reason === 'trailing_stop' ? 'Trailing SL' : 'Stop loss'} hit: ${label}`, `${this.name} · exit @ ₹${exitPrice.toFixed(2)} · P&L ₹${pnl.toFixed(2)}`)
    } else if (reason === 'target') {
      await notify(this.userId, 'target_hit', `Target hit: ${label}`, `${this.name} · exit @ ₹${exitPrice.toFixed(2)} · P&L ₹${pnl.toFixed(2)}`)
    } else {
      await notify(this.userId, 'order_filled', `Position closed (${reason.replace(/_/g, ' ')}): ${label}`, `${this.name} · P&L ₹${pnl.toFixed(2)}`)
    }
  }
}

// ── state helpers ──

function readState(position: PositionRow): PositionRuntimeState {
  const raw = (position.runtime_state ?? {}) as Partial<PositionRuntimeState>
  return {
    stopLoss: num(raw.stopLoss),
    stopLossSource: raw.stopLossSource === 'trail' ? 'trail' : 'base',
    target: num(raw.target),
    trailDistance: num(raw.trailDistance),
    peakPrice: num(raw.peakPrice) ?? Number(position.average_entry_price),
    barsHeld: typeof raw.barsHeld === 'number' ? raw.barsHeld : 0,
    lastCandleTime: typeof raw.lastCandleTime === 'string' ? raw.lastCandleTime : undefined,
    entryTime: typeof raw.entryTime === 'string' ? raw.entryTime : position.opened_at,
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function toState(
  levels: { stopLoss?: number; target?: number; trailDistance?: number },
  extra: Pick<PositionRuntimeState, 'barsHeld' | 'entryTime'> & Partial<PositionRuntimeState>,
): PositionRuntimeState {
  return {
    stopLoss: levels.stopLoss,
    stopLossSource: 'base',
    target: levels.target,
    trailDistance: levels.trailDistance,
    peakPrice: undefined,
    barsHeld: extra.barsHeld,
    lastCandleTime: extra.lastCandleTime,
    entryTime: extra.entryTime,
  }
}

const IST_OFFSET = 5.5 * 3600 * 1000

/** First bucket of the next session when activating outside market hours. */
function nextSessionFirstBucket(nowMs: number, timeframeMinutes: number): number {
  for (let d = 1; d <= 7; d++) {
    const candidate = nowMs + d * 86400000
    const dayStartIst = Math.floor((candidate + IST_OFFSET) / 86400000) * 86400000 - IST_OFFSET
    const firstBucket = dayStartIst + (9 * 60 + 15) * 60000
    if (firstBucket > nowMs) return firstBucket + timeframeMinutes * 60000
  }
  return nowMs + 86400000 // unreachable
}
