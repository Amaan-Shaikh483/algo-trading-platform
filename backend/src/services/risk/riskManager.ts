import { getServiceClient } from '../../supabase/client'
import type { DailyRiskCounterRow, UserRiskSettingsRow } from '../../supabase/types'
import { logger } from '../../lib/logger'
import { auditLog, notify } from '../userEvents'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * RISK MANAGER (spec §3.7) — the central order gate.
 *
 * EVERY order placement — paper or live, entry or exit — MUST pass through
 * `authorizeOrder` before it reaches a fill (paper) or the broker (live).
 * There is no other path to an order in this codebase: the order router
 * (services/live/orderRouter.ts) and the kill-switch service both call this
 * module, and step-10 unit tests assert the contract stays closed.
 *
 * Scope decisions (documented, conservative):
 *  - Account-level counters/limits track LIVE trading only — paper trading
 *    risks no money; per-strategy limits (maxTradesPerDay, capitalAllocation%)
 *    from the strategy rules are enforced by the strategy runtime in BOTH
 *    modes, mirroring the backtest engine.
 *  - EXITS are never blocked by risk controls — blocking an exit would
 *    increase risk. Exits still pass through the gate for sanity checks and
 *    (live only) broker-connectivity verification.
 *  - Live entries require account risk limits to be configured
 *    (max_daily_loss at minimum) — RISK_NOT_CONFIGURED. This mirrors the
 *    §3.4 mode-toggle guard "live requires risk limits" from step 5.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type BlockCode =
  | 'INVALID_ORDER'
  | 'KILL_SWITCH'
  | 'DAILY_LOSS_LIMIT'
  | 'MAX_TRADES_PER_DAY'
  | 'MAX_OPEN_POSITIONS'
  | 'CAPITAL_LIMIT'
  | 'BROKER_NOT_CONNECTED'
  | 'RISK_NOT_CONFIGURED'

export interface OrderIntent {
  userId: string
  strategyId: string
  strategyName: string
  symbol: string
  symbolToken: string
  exchange: string
  /** BUY to open a LONG / close a SHORT; SELL to open a SHORT / close a LONG. */
  side: 'BUY' | 'SELL'
  quantity: number
  /** Expected fill reference (paper: current LTP; live: LTP/limit). */
  approxPrice: number
  mode: 'paper' | 'live'
  purpose: 'entry' | 'exit'
}

export interface RiskDecision {
  approved: boolean
  code?: BlockCode
  reason?: string
}

/** Pure gate — every input pre-fetched by the caller's RiskStore. Exported for step-10 unit tests. */
export function evaluateGate(input: {
  intent: OrderIntent
  settings: UserRiskSettingsRow | null
  counter: DailyRiskCounterRow | null
  openLivePositions: number
  deployedLiveCapital: number
  brokerStatus: string | null
}): RiskDecision {
  const { intent, settings, counter } = input

  // 1. Sanity — a malformed intent is never authorized, entry or exit.
  if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
    return { approved: false, code: 'INVALID_ORDER', reason: 'Quantity must be positive' }
  }
  if (!Number.isFinite(intent.approxPrice) || intent.approxPrice <= 0) {
    return { approved: false, code: 'INVALID_ORDER', reason: 'Reference price must be positive' }
  }
  if (!intent.symbol || !intent.symbolToken) {
    return { approved: false, code: 'INVALID_ORDER', reason: 'Instrument token missing' }
  }

  // 2. Live orders (entry AND exit) require a Connected broker (spec §3.7).
  if (intent.mode === 'live' && input.brokerStatus !== 'connected') {
    return {
      approved: false,
      code: 'BROKER_NOT_CONNECTED',
      reason: `Broker connection is ${input.brokerStatus ?? 'missing'} — live orders blocked`,
    }
  }

  // 3. EXITS: always allowed past sanity + connectivity — an exit reduces risk;
  //    blocking it under a kill switch / loss limit would trap a losing position.
  if (intent.purpose === 'exit') return { approved: true }

  // ── ENTRIES from here ──
  if (settings?.kill_switch_active) {
    return { approved: false, code: 'KILL_SWITCH', reason: 'Kill switch is active — all new entries halted' }
  }
  if (counter?.is_blocked) {
    return {
      approved: false,
      code: 'DAILY_LOSS_LIMIT',
      reason: counter.blocked_reason ?? 'Trading is blocked for today — daily loss limit',
    }
  }
  if (intent.mode === 'live' && (settings == null || settings.max_daily_loss == null)) {
    return {
      approved: false,
      code: 'RISK_NOT_CONFIGURED',
      reason: 'Set account risk limits (max daily loss) before live trading',
    }
  }
  if (
    intent.mode === 'live' &&
    settings?.max_daily_loss != null &&
    counter != null &&
    counter.realized_pnl <= -Math.abs(settings.max_daily_loss)
  ) {
    // Live pre-check: counter already past the limit but not yet flagged blocked.
    return {
      approved: false,
      code: 'DAILY_LOSS_LIMIT',
      reason: `Daily loss limit hit: realized ₹${counter.realized_pnl.toFixed(2)} vs limit ₹${settings.max_daily_loss}`,
    }
  }
  if (intent.mode === 'live' && settings?.max_trades_per_day != null && (counter?.trades_count ?? 0) >= settings.max_trades_per_day) {
    return {
      approved: false,
      code: 'MAX_TRADES_PER_DAY',
      reason: `Account trade limit reached (${settings.max_trades_per_day}/day)`,
    }
  }
  if (intent.mode === 'live' && settings?.max_open_positions != null && input.openLivePositions >= settings.max_open_positions) {
    return {
      approved: false,
      code: 'MAX_OPEN_POSITIONS',
      reason: `Account open-position limit reached (${settings.max_open_positions})`,
    }
  }
  if (intent.mode === 'live' && settings?.capital_allocation_limit != null) {
    const notional = intent.approxPrice * intent.quantity
    if (input.deployedLiveCapital + notional > settings.capital_allocation_limit) {
      return {
        approved: false,
        code: 'CAPITAL_LIMIT',
        reason: `Capital allocation limit would be exceeded (deployed ₹${input.deployedLiveCapital.toFixed(0)} + ₹${notional.toFixed(0)} > ₹${settings.capital_allocation_limit})`,
      }
    }
  }
  return { approved: true }
}

// ── Store (swappable for unit tests) ─────────────────────────────────────────

export interface RiskStore {
  getSettings(userId: string): Promise<UserRiskSettingsRow | null>
  getCounter(userId: string, tradingDate: string): Promise<DailyRiskCounterRow | null>
  countOpenLivePositions(userId: string): Promise<number>
  deployedLiveCapital(userId: string): Promise<number>
  getBrokerStatus(userId: string): Promise<string | null>
  bumpCounters(userId: string, tradingDate: string, realizedDelta: number, tradesDelta: number): Promise<DailyRiskCounterRow>
  setBlocked(userId: string, tradingDate: string, reason: string): Promise<void>
  clearBlocked(userId: string, tradingDate: string): Promise<void>
  /** Auto-pause: deactivate all ACTIVE LIVE strategies. Returns their names. */
  deactivateLiveStrategies(userId: string): Promise<string[]>
}

/** IST calendar date for risk counters (risk days follow the Indian market day). */
export function riskTradingDate(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000)
  return ist.toISOString().slice(0, 10)
}

export function supabaseRiskStore(): RiskStore {
  return {
    async getSettings(userId) {
      const { data, error } = await getServiceClient().from('user_risk_settings').select('*').eq('user_id', userId).maybeSingle()
      if (error) throw new Error(`risk settings read failed: ${error.message}`)
      return data
    },
    async getCounter(userId, tradingDate) {
      const { data, error } = await getServiceClient()
        .from('daily_risk_counters')
        .select('*')
        .eq('user_id', userId)
        .eq('trading_date', tradingDate)
        .maybeSingle()
      if (error) throw new Error(`risk counter read failed: ${error.message}`)
      return data
    },
    async countOpenLivePositions(userId) {
      const { count, error } = await getServiceClient()
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('mode', 'live')
        .eq('status', 'open')
      if (error) throw new Error(`open-position count failed: ${error.message}`)
      return count ?? 0
    },
    async deployedLiveCapital(userId) {
      const { data, error } = await getServiceClient()
        .from('positions')
        .select('quantity, average_entry_price')
        .eq('user_id', userId)
        .eq('mode', 'live')
        .eq('status', 'open')
      if (error) throw new Error(`deployed-capital read failed: ${error.message}`)
      return (data ?? []).reduce((acc, p) => acc + p.quantity * Number(p.average_entry_price), 0)
    },
    async getBrokerStatus(userId) {
      const { data, error } = await getServiceClient()
        .from('broker_connections')
        .select('status')
        .eq('user_id', userId)
        .eq('broker', 'angelone')
        .maybeSingle()
      if (error) throw new Error(`broker status read failed: ${error.message}`)
      return data?.status ?? null
    },
    async bumpCounters(userId, tradingDate, realizedDelta, tradesDelta) {
      const { data, error } = await getServiceClient().rpc('record_trade_counters', {
        p_user_id: userId,
        p_trading_date: tradingDate,
        p_realized_delta: realizedDelta,
        p_trades_delta: tradesDelta,
      })
      if (error) throw new Error(`counter upsert failed: ${error.message}`)
      return (Array.isArray(data) ? data[0] : data) as DailyRiskCounterRow
    },
    async setBlocked(userId, tradingDate, reason) {
      const { error } = await getServiceClient()
        .from('daily_risk_counters')
        .update({ is_blocked: true, blocked_reason: reason })
        .eq('user_id', userId)
        .eq('trading_date', tradingDate)
      if (error) throw new Error(`set blocked failed: ${error.message}`)
    },
    async clearBlocked(userId, tradingDate) {
      const { error } = await getServiceClient()
        .from('daily_risk_counters')
        .update({ is_blocked: false, blocked_reason: null })
        .eq('user_id', userId)
        .eq('trading_date', tradingDate)
      if (error) throw new Error(`clear blocked failed: ${error.message}`)
    },
    async deactivateLiveStrategies(userId) {
      const { data, error } = await getServiceClient()
        .from('strategies')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('mode', 'live')
        .eq('is_active', true)
        .select('id, name')
      if (error) throw new Error(`strategy auto-pause failed: ${error.message}`)
      return (data ?? []).map((s) => s.name)
    },
  }
}

// ── Gate entry point + counter writers (with spec §3.9 event fan-out) ────────

/** Notify at most once per (user, block code) per 15 min — the strategy engine
 *  re-evaluates entries every candle close and a persistent block must not spam. */
const blockNotifyThrottle = new Map<string, number>()

/**
 * THE gate. Callers: orderRouter (every order), killSwitchService (exits).
 * Blocked entries produce an order_rejected notification (throttled) + audit row.
 */
export async function authorizeOrder(intent: OrderIntent, store: RiskStore = supabaseRiskStore()): Promise<RiskDecision> {
  const tradingDate = riskTradingDate()
  // Fetch lazily per mode to keep paper-mode cheap: counters/limits are
  // live-scope only, but a paper ENTRY still needs kill-switch + block flag,
  // which live in settings/counter rows too — fetching both rows always keeps
  // the decision table identical across modes.
  const [settings, counter, openLivePositions, deployedLiveCapital, brokerStatus] = await Promise.all([
    store.getSettings(intent.userId),
    store.getCounter(intent.userId, tradingDate),
    store.countOpenLivePositions(intent.userId),
    store.deployedLiveCapital(intent.userId),
    store.getBrokerStatus(intent.userId),
  ])

  const decision = evaluateGate({ intent, settings, counter, openLivePositions, deployedLiveCapital, brokerStatus })
  if (decision.approved) return decision

  logger.warn('risk gate blocked order', { userId: intent.userId, strategyId: intent.strategyId, code: decision.code, mode: intent.mode })
  if (intent.purpose === 'entry') {
    const throttleKey = `${intent.userId}:${decision.code}`
    const last = blockNotifyThrottle.get(throttleKey) ?? 0
    if (Date.now() - last > 15 * 60 * 1000) {
      blockNotifyThrottle.set(throttleKey, Date.now())
      await notify(
        intent.userId,
        'order_rejected',
        `Order blocked by risk manager (${decision.code})`,
        `${intent.strategyName} · ${intent.side} ${intent.quantity} ${intent.symbol} — ${decision.reason}`,
      )
    }
    if (decision.code === 'KILL_SWITCH' || decision.code === 'DAILY_LOSS_LIMIT') {
      await auditLog(intent.userId, 'risk.order_blocked', {
        strategyId: intent.strategyId,
        code: decision.code,
        reason: decision.reason,
        mode: intent.mode,
      })
    }
  }
  return decision
}

/** Count an authorized LIVE entry against today's account trade counter. */
export async function recordAuthorizedTrade(userId: string, store: RiskStore = supabaseRiskStore()): Promise<void> {
  await store.bumpCounters(userId, riskTradingDate(), 0, 1)
}

/**
 * Record a closed LIVE trade's realized P&L and enforce the §3.7 daily-loss
 * auto-pause: on breach, flag today blocked + deactivate all live strategies
 * + notify. Returns whether the auto-pause fired on this trade.
 */
export async function recordClosedTrade(
  userId: string,
  realizedPnl: number,
  store: RiskStore = supabaseRiskStore(),
): Promise<{ autoPaused: boolean }> {
  const tradingDate = riskTradingDate()
  const row = await store.bumpCounters(userId, tradingDate, realizedPnl, 0)
  const settings = await store.getSettings(userId)
  if (settings?.max_daily_loss == null || row.is_blocked) return { autoPaused: false }
  if (row.realized_pnl > -Math.abs(settings.max_daily_loss)) return { autoPaused: false }

  const reason = `Daily loss limit hit: realized ₹${row.realized_pnl.toFixed(2)} vs limit ₹${settings.max_daily_loss} — all live strategies auto-paused`
  await store.setBlocked(userId, tradingDate, reason)
  const paused = await store.deactivateLiveStrategies(userId)
  await notify(userId, 'daily_loss_limit', 'Daily loss limit reached', reason)
  await auditLog(userId, 'risk.daily_loss_auto_pause', {
    realizedPnl: row.realized_pnl,
    limit: settings.max_daily_loss,
    deactivatedStrategies: paused,
  })
  logger.warn('daily-loss auto-pause fired', { userId, realizedPnl: row.realized_pnl, paused })
  return { autoPaused: true }
}

/** §3.7 "manual override": clears today's daily-loss block (strategies stay paused; user re-activates). */
export async function clearDailyBlock(userId: string, store: RiskStore = supabaseRiskStore()): Promise<void> {
  const tradingDate = riskTradingDate()
  await store.clearBlocked(userId, tradingDate)
  await auditLog(userId, 'risk.daily_block_cleared', { tradingDate })
}
