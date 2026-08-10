import type { BrokerAdapter } from '../brokers/types'
import { getServiceClient } from '../../supabase/client'
import type { StrategyRow } from '../../supabase/types'
import { logger } from '../../lib/logger'
import { getSessionAdapterForUser } from '../brokerConnectionService'
import { CandleAggregator, MARKET_CLOSE_MIN, MARKET_OPEN_MIN } from './candleAggregator'
import { MarketFeedManager } from './marketFeedManager'
import { StrategyRuntime } from './strategyRuntime'
import type { RuntimeDeps } from './strategyRuntime'
import { killSwitchSweep } from '../risk/killSwitchService'
import { reconcileUser } from './reconciliationService'
import { notify } from '../userEvents'
import { WS_EXCHANGE_TYPE } from './liveTypes'
import type { Exchange } from '../brokers/types'

/**
 * Live engine supervisor (spec §3.6, build step 7) — runs inside the dedicated
 * worker process (`npm run worker`, decision recorded in CHECKPOINT-04: a
 * persistent Node process, since Edge Functions can't hold WebSockets).
 *
 * Loops:
 *   - strategy reconcile (5s):  diff active strategies ↔ in-memory runtimes;
 *     restart runtimes whose strategy row changed; stop removed ones
 *   - tick fan-out:             feed ticks → candle aggregators → runtimes
 *   - candle sweep (1s):        close elapsed buckets → runtime.onCandleClose
 *   - kill-switch sweeper(15s): retry square-offs while the switch is on
 *   - reconciliation (60s):     broker order/position book vs our ledger
 *   - heartbeat (10s):          worker_heartbeats upsert for the dashboard
 */

const STRATEGY_POLL_MS = 5_000
const CANDLE_SWEEP_MS = 1_000
const KILL_SWEEP_MS = 15_000
const RECONCILE_MS = 60_000
const HEARTBEAT_MS = 10_000
const MARGIN_CACHE_MS = 30_000

export class LiveEngineSupervisor {
  private runtimes = new Map<string, StrategyRuntime>()
  private strategyStamps = new Map<string, string>() // strategy_id → updated_at seen
  private aggregators = new Map<string, CandleAggregator>() // `${userId}|${token}|${timeframe}`
  private adapters = new Map<string, BrokerAdapter>()
  private wiredUsers = new Set<string>()
  private noSessionNoticeAt = new Map<string, number>()
  private marginCache = new Map<string, { value: number | null; at: number }>()
  private timers: NodeJS.Timeout[] = []
  private readonly startedAt = Date.now()
  private readonly feedManager: MarketFeedManager

  constructor() {
    this.feedManager = new MarketFeedManager(
      (userId) => this.adapterFor(userId),
      (userId) => {
        logger.info('feed reconnected — triggering candle catch-up', { userId })
        for (const rt of this.runtimes.values()) {
          if (rt.userId === userId) void rt.catchUp()
        }
      },
    )
  }

  async start(): Promise<void> {
    logger.info('live engine supervisor starting')
    await this.reconcileStrategies()
    this.timers.push(
      setInterval(() => void this.guard('reconcileStrategies', () => this.reconcileStrategies()), STRATEGY_POLL_MS),
      setInterval(() => this.sweepCandles(), CANDLE_SWEEP_MS),
      setInterval(() => void this.guard('killSwitchSweep', () => this.killSweep()), KILL_SWEEP_MS),
      setInterval(() => void this.guard('reconcile', () => this.reconcileLoop()), RECONCILE_MS),
      setInterval(() => void this.guard('heartbeat', () => this.heartbeat()), HEARTBEAT_MS),
    )
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t)
    for (const rt of this.runtimes.values()) rt.stop()
    await this.feedManager.shutdown()
    logger.info('live engine supervisor stopped')
  }

  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      logger.error(`supervisor loop failed: ${name}`, { error: (err as Error).message })
    }
  }

  // ── adapters / session cache ──

  private async adapterFor(userId: string): Promise<BrokerAdapter> {
    // getSessionAdapterForUser re-reads the session row each call (daily token
    // refresh / auto-relogin are then automatically picked up); the registry
    // returns the same adapter instance, keeping limiter state warm.
    const { adapter } = await getSessionAdapterForUser(userId)
    this.adapters.set(userId, adapter)
    return adapter
  }

  private runtimeDeps(): RuntimeDeps {
    return {
      adapterFor: (userId) => {
        const cached = this.adapters.get(userId)
        return cached ? Promise.resolve(cached) : this.adapterFor(userId)
      },
      candlesFor: async (userId, exchange, token, interval, from, to) => {
        const adapter = await this.adapterFor(userId)
        return adapter.getCandleData({ exchange: exchange as Exchange, symboltoken: token, interval, from, to })
      },
      availableMarginFor: async (userId) => {
        const cached = this.marginCache.get(userId)
        if (cached && Date.now() - cached.at < MARGIN_CACHE_MS) return cached.value
        try {
          const adapter = await this.adapterFor(userId)
          const rms = await adapter.getRMS()
          const value = rms.availableMargin
          this.marginCache.set(userId, { value, at: Date.now() })
          return value
        } catch (err) {
          logger.warn('RMS read failed (capital%% gate skipped this bar)', { userId, error: (err as Error).message })
          this.marginCache.set(userId, { value: null, at: Date.now() })
          return null
        }
      },
    }
  }

  // ── strategy diff loop ──

  private async reconcileStrategies(): Promise<void> {
    const { data: rows, error } = await getServiceClient()
      .from('strategies')
      .select('*')
      .eq('is_active', true)
    if (error) throw new Error(`active strategy read failed: ${error.message}`)
    const active = (rows ?? []) as StrategyRow[]
    const activeIds = new Set(active.map((s) => s.id))

    // stop: strategy paused/deleted or edited (rules version bump → clean restart; positions resume from DB)
    for (const [id, rt] of [...this.runtimes]) {
      const row = active.find((s) => s.id === id)
      if (!row) {
        rt.stop()
        this.runtimes.delete(id)
        this.strategyStamps.delete(id)
        logger.info('runtime stopped (strategy deactivated)', { strategyId: id })
      } else if (this.strategyStamps.get(id) !== row.updated_at) {
        rt.stop()
        this.runtimes.delete(id)
        logger.info('runtime restarting (strategy row changed)', { strategyId: id })
      }
    }

    // group by user → sessions + feeds
    const byUser = new Map<string, StrategyRow[]>()
    for (const s of active) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, [])
      byUser.get(s.user_id)!.push(s)
    }

    const wantedUsers = new Set(byUser.keys())
    for (const [userId, strategies] of byUser) {
      let adapter: BrokerAdapter
      try {
        adapter = await this.adapterFor(userId)
      } catch (err) {
        // No/expired session: strategies stay active but unrunnable until the
        // daily refresh or a manual reconnect. Throttled notice (15 min).
        const last = this.noSessionNoticeAt.get(userId) ?? 0
        if (Date.now() - last > 15 * 60 * 1000) {
          this.noSessionNoticeAt.set(userId, Date.now())
          await notify(
            userId,
            'token_expired',
            'Broker session unavailable — strategies paused',
            `${strategies.length} active strateg${strategies.length === 1 ? 'y is' : 'ies are'} waiting for a Connected broker. Reconnect on the Broker page.`,
          )
        }
        logger.warn('no broker session; skipping user this cycle', { userId, error: (err as Error).message })
        continue
      }

      // feed subscriptions (token set across the user's strategies)
      const wanted = new Map<number, Set<string>>()
      for (const s of strategies) {
        const exchangeType = WS_EXCHANGE_TYPE[s.exchange as Exchange] ?? 1
        if (!wanted.has(exchangeType)) wanted.set(exchangeType, new Set())
        wanted.get(exchangeType)!.add(s.symbol_token)
      }
      await this.feedManager.syncUser(userId, wanted)

      // wire tick fan-out once per user
      if (!this.wiredUsers.has(userId)) {
        this.wiredUsers.add(userId)
        this.feedManager.onTick(userId, (tick) => this.fanOutTick(userId, tick))
      }

      // start runtimes for new strategies
      for (const s of strategies) {
        if (this.runtimes.has(s.id)) continue
        try {
          const rt = await StrategyRuntime.create(s, this.runtimeDeps())
          this.runtimes.set(s.id, rt)
          this.strategyStamps.set(s.id, s.updated_at)
          const key = `${s.user_id}|${s.symbol_token}|${s.timeframe}`
          if (!this.aggregators.has(key)) {
            this.aggregators.set(key, new CandleAggregator(s.timeframe, (candle) => this.fanOutCandle(key, candle)))
          }
          logger.info('runtime started', { strategyId: s.id, name: s.name, mode: s.mode, timeframe: s.timeframe })
        } catch (err) {
          logger.error('runtime start failed', { strategyId: s.id, name: s.name, error: (err as Error).message })
          await notify(s.user_id, 'strategy_error', `Strategy failed to start: ${s.name}`, (err as Error).message)
        }
      }
    }

    // users with no active strategies: unwind their feeds
    for (const userId of [...this.adapters.keys()]) {
      if (!wantedUsers.has(userId)) {
        await this.feedManager.stopUser(userId)
        this.adapters.delete(userId)
        this.wiredUsers.delete(userId)
        this.marginCache.delete(userId)
      }
    }
    // prune aggregators no runtime uses anymore
    for (const key of [...this.aggregators.keys()]) {
      const [userId, token, tf] = key.split('|')
      const inUse = [...this.runtimes.values()].some(
        (rt) => rt.userId === userId && rt.symbolToken === token && rt.timeframe === tf,
      )
      if (!inUse) this.aggregators.delete(key)
    }
  }

  private fanOutTick(userId: string, tick: import('./liveTypes').LiveTick): void {
    for (const [key, agg] of this.aggregators) {
      if (key.startsWith(`${userId}|${tick.symbolToken}|`)) agg.addTick(tick.ts, tick.price, tick.qty)
    }
    for (const rt of this.runtimes.values()) {
      if (rt.userId === userId && rt.symbolToken === tick.symbolToken) {
        void rt.onTick(tick).catch((err) => logger.error('runtime tick error', { strategyId: rt.id, error: (err as Error).message }))
      }
    }
  }

  private fanOutCandle(aggKey: string, candle: import('../brokers/types').Candle): void {
    const [userId, token, tf] = aggKey.split('|')
    for (const rt of this.runtimes.values()) {
      if (rt.userId === userId && rt.symbolToken === token && rt.timeframe === tf) {
        void rt.onCandleClose(candle).catch((err) => logger.error('runtime candle error', { strategyId: rt.id, error: (err as Error).message }))
      }
    }
  }

  private sweepCandles(): void {
    for (const agg of this.aggregators.values()) agg.sweep()
  }

  // ── kill switch sweeper ──

  private async killSweep(): Promise<void> {
    const { data } = await getServiceClient().from('positions').select('user_id').eq('status', 'open')
    const users = new Set((data ?? []).map((p) => (p as { user_id: string }).user_id))
    for (const userId of users) await killSwitchSweep(userId)
  }

  // ── reconciliation ──

  private async reconcileLoop(): Promise<void> {
    const nowIst = istMinutesNow()
    if (nowIst < MARKET_OPEN_MIN - 15 || nowIst > MARKET_CLOSE_MIN + 30) return // 09:00–16:00 IST window
    for (const userId of this.adapters.keys()) {
      try {
        const adapter = this.adapters.get(userId)
        if (!adapter) continue
        const hasLive = [...this.runtimes.values()].some((rt) => rt.userId === userId && rt.mode === 'live')
        if (!hasLive) continue
        const summary = await reconcileUser(userId, adapter, (strategyId) => this.runtimes.get(strategyId))
        if (summary.ordersSynced > 0 || summary.positionsClosed > 0) {
          logger.info('reconciliation applied', summary as never)
        }
      } catch (err) {
        logger.warn('reconciliation failed this cycle', { userId, error: (err as Error).message })
      }
    }
  }

  // ── heartbeat ──

  private async heartbeat(): Promise<void> {
    const state = {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      runtimes: [...this.runtimes.values()].map((rt) => ({
        strategyId: rt.id,
        name: rt.name,
        mode: rt.mode,
        timeframe: rt.timeframe,
        awaitingSettlement: rt.awaitingSettlement,
      })),
      feeds: this.feedManager.statusSummary(),
      aggregators: this.aggregators.size,
      updatedAt: new Date().toISOString(),
    }
    const { error } = await getServiceClient()
      .from('worker_heartbeats')
      .upsert({ worker: 'live-engine', state: state as never, updated_at: new Date().toISOString() } as never)
    if (error) logger.warn('heartbeat write failed', { error: error.message })
  }
}

const IST_OFF = 5.5 * 3600 * 1000
function istMinutesNow(): number {
  return Math.floor(((Date.now() + IST_OFF) % 86400000) / 60000)
}
