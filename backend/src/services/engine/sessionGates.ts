import { istMinutesOfDay } from './indicatorEngine'
import { normalizeOrderType, normalizeRiskManagement } from '@algo/rule-schema'
import type { OrderTypeConfig, RiskManagementConfig, StrategyRules, TradingDay } from '@algo/rule-schema'

/**
 * Order Type + Risk Management session gates — SHARED by the backtest engine
 * and the live strategy runtime so backtest ↔ live parity holds for the
 * builder's Order Type (MIS/CNC/BTST session window + trading days) and Risk
 * Management (no-trade cutoff, max trade cycle, overall profit/loss exits and
 * profit trailing) configuration.
 *
 * Everything here is defensive about missing config: strategies saved before
 * the feature shipped normalize to MIS / Mon–Fri / 09:16–15:10 defaults, so
 * their behaviour is unchanged.
 */

const IST_WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' })

/** 'MON' | 'TUE' | … for an instant, in IST. */
export function istWeekday(time: Date): string {
  return IST_WEEKDAY.format(time).slice(0, 3).toUpperCase()
}

export interface SessionGates {
  orderType: OrderTypeConfig
  riskManagement: RiskManagementConfig
  /** Minutes since IST midnight when entries may begin (null = not gated). */
  startMinutes: number | null
  /** Minutes since IST midnight after which NO new trades may open (null = not gated). */
  noNewTradeMinutes: number | null
  /** Minutes since IST midnight when open positions square off (null = not gated). */
  squareOffMinutes: number | null
  /** True when the strategy actually carries an Order Type block. */
  hasOrderTypeConfig: boolean
  /** True when the strategy actually carries a Risk Management block. */
  hasRiskManagementConfig: boolean
}

function toMinutes(hhmm: string | null | undefined, fallback: number): number {
  if (!hhmm) return fallback
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback
  return h * 60 + m
}

export function buildSessionGates(rules: StrategyRules): SessionGates {
  const orderType = normalizeOrderType(rules)
  const riskManagement = normalizeRiskManagement(rules)

  // BACKWARD COMPATIBILITY: a strategy saved before this feature shipped has
  // no orderType / riskManagement block. Such strategies must keep behaving
  // EXACTLY as they did — the normalized defaults describe what the builder
  // would show, but they must NOT retroactively gate an existing strategy's
  // entries. Only explicitly configured blocks produce gates.
  const hasOrderTypeConfig = rules?.orderType != null
  const hasRiskManagementConfig = rules?.riskManagement != null

  const startMinutes = hasOrderTypeConfig ? toMinutes(orderType.startTime, 0) : null

  // BTST holds overnight — there is no same-day square off.
  const squareOffMinutes =
    hasOrderTypeConfig && orderType.type !== 'BTST' ? toMinutes(orderType.squareOffTime, 24 * 60) : null

  const noTradeAfter = hasRiskManagementConfig ? toMinutes(riskManagement.noTradeAfter, 24 * 60) : null
  const noNewTradeMinutes =
    noTradeAfter != null && squareOffMinutes != null
      ? Math.min(noTradeAfter, squareOffMinutes)
      : (noTradeAfter ?? squareOffMinutes)

  return {
    orderType,
    riskManagement,
    startMinutes,
    noNewTradeMinutes,
    squareOffMinutes,
    hasOrderTypeConfig,
    hasRiskManagementConfig,
  }
}

/** Max entry→exit cycles per day, or null when not configured. */
export function maxTradeCycleFor(gates: SessionGates): number | null {
  return gates.hasRiskManagementConfig ? gates.riskManagement.maxTradeCycle : null
}

/** True when the strategy is allowed to trade on this instant's IST weekday. */
export function isTradingDay(gates: SessionGates, time: Date): boolean {
  if (!gates.hasOrderTypeConfig) return true
  const days = gates.orderType.tradingDays
  if (!days || days.length === 0) return true
  return days.includes(istWeekday(time) as TradingDay)
}

/** True when a NEW entry is allowed at this instant (day + session window). */
export function canOpenNewTrade(gates: SessionGates, time: Date): boolean {
  if (!isTradingDay(gates, time)) return false
  const minutes = istMinutesOfDay(time)
  if (gates.startMinutes != null && minutes < gates.startMinutes) return false
  if (gates.noNewTradeMinutes != null && minutes >= gates.noNewTradeMinutes) return false
  return true
}

/** True when open positions must be squared off (MIS/CNC same-day cutoff). */
export function isPastSquareOff(gates: SessionGates, time: Date): boolean {
  return gates.squareOffMinutes != null && istMinutesOfDay(time) >= gates.squareOffMinutes
}

/**
 * BTST square-off: positions opened on day D exit at the next-day square-off
 * time on the first session at/after D+1.
 */
export function isPastNextDaySquareOff(gates: SessionGates, entryTime: Date, now: Date): boolean {
  if (!gates.hasOrderTypeConfig || gates.orderType.type !== 'BTST') return false
  const cutoff = toMinutes(gates.orderType.nextDaySquareOffTime, 15 * 60 + 10)
  const entryDay = new Date(entryTime).setHours(0, 0, 0, 0)
  const nowDay = new Date(now).setHours(0, 0, 0, 0)
  if (nowDay <= entryDay) return false
  return istMinutesOfDay(now) >= cutoff
}

/**
 * Strategy-level profit trailing. Tracks the running strategy P&L (realized +
 * unrealized, in INR) and reports the locked-in floor that P&L may not fall
 * back below.
 *
 *   LOCK_FIX_PROFIT — once P&L ≥ ifProfitReaches, floor = lockProfitAt.
 *   TRAIL_PROFIT    — for every onEveryIncreaseOf of profit, the floor
 *                     advances by trailProfitBy.
 *   LOCK_AND_TRAIL  — lock first, then trail on top of the locked floor.
 */
export class ProfitTrailer {
  /** Floor established by the LOCK step (null until armed). */
  private baseLock: number | null = null
  /** Number of completed trail steps. */
  private steps = 0
  /** Current effective floor = baseLock + steps × trailProfitBy. */
  private locked: number | null = null

  constructor(private readonly config: RiskManagementConfig) {}

  get lockedProfit(): number | null {
    return this.locked
  }

  reset(): void {
    this.baseLock = null
    this.steps = 0
    this.locked = null
  }

  /** Feed the current strategy P&L; @returns the active locked floor (or null). */
  update(pnl: number): number | null {
    const t = this.config.profitTrailing
    if (!t || t.type === 'NO_TRAILING') return null

    const lockMode = t.type === 'LOCK_FIX_PROFIT' || t.type === 'LOCK_AND_TRAIL'
    const trailMode = t.type === 'TRAIL_PROFIT' || t.type === 'LOCK_AND_TRAIL'

    if (lockMode) {
      const reach = Number(t.ifProfitReaches)
      const lock = Number(t.lockProfitAt)
      if (this.baseLock == null && Number.isFinite(reach) && Number.isFinite(lock) && pnl >= reach) {
        this.baseLock = lock
      }
    }

    if (trailMode) {
      const step = Number(t.onEveryIncreaseOf)
      const by = Number(t.trailProfitBy)
      // Lock & Trail only starts trailing once the initial lock is armed, and
      // measures steps from the lock trigger; Trail Profit measures from zero.
      const armed = t.type !== 'LOCK_AND_TRAIL' || this.baseLock != null
      const origin = t.type === 'LOCK_AND_TRAIL' ? Number(t.ifProfitReaches) : 0
      if (armed && Number.isFinite(step) && step > 0 && Number.isFinite(by) && Number.isFinite(origin)) {
        // Steps are recomputed absolutely (never compounded) and only ratchet up.
        this.steps = Math.max(this.steps, Math.floor(Math.max(0, pnl - origin) / step))
      }
    }

    if (this.baseLock != null || this.steps > 0) {
      const by = Number(t.trailProfitBy)
      const trailAdd = trailMode && Number.isFinite(by) ? this.steps * by : 0
      this.locked = (this.baseLock ?? 0) + trailAdd
    }

    return this.locked
  }

  /** True when P&L has fallen back to the locked floor and must be booked. */
  shouldBook(pnl: number): boolean {
    const floor = this.update(pnl)
    return floor != null && pnl <= floor
  }
}

/** True when overall strategy P&L breached the configured profit/loss limits. */
export function hitOverallLimit(cfg: RiskManagementConfig, pnl: number): 'profit' | 'loss' | null {
  const profit = Number(cfg.exitProfit)
  if (Number.isFinite(profit) && profit > 0 && pnl >= profit) return 'profit'
  const loss = Number(cfg.exitLoss)
  if (Number.isFinite(loss) && loss > 0 && pnl <= -Math.abs(loss)) return 'loss'
  return null
}
