import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizeOrder, evaluateGate, riskTradingDate } from './riskManager'
import type { OrderIntent, RiskStore } from './riskManager'
import type { DailyRiskCounterRow, UserRiskSettingsRow } from '../../supabase/types'
import { auditLog, notify } from '../userEvents'

/**
 * Spec §6 step 10 — formal unit tests for the Risk Manager (§3.7): the gate
 * every order must pass. Locks the full decision table:
 *   sanity → broker connectivity (live) → exit fast-path (never blocked) →
 *   kill switch → daily-loss block → live-configured → loss pre-check →
 *   trades/day → open positions → capital limit → approve
 * …for BOTH modes (paper entries share the kill-switch/block gates so paper
 * behavior proves live behavior; account counters stay live-scoped).
 *
 * Boundary mocked at OUR unit seam (userEvents): the notify/audit side
 * effects are asserted as calls, not network traffic — their Supabase
 * plumbing is exercised by the scripts/verify-live.mjs integration harness.
 * Mocking the deeper supabase/client would leave 7s auth-retry backoffs
 * against the offline dummy URL inside the test hot path.
 */
vi.mock('../userEvents', () => ({
  notify: vi.fn(async () => {}),
  auditLog: vi.fn(async () => {}),
}))

/* ── fixtures ── */

const baseIntent: OrderIntent = {
  userId: 'u1',
  strategyId: 's1',
  strategyName: 'TestStrategy',
  symbol: 'SBIN-EQ',
  symbolToken: '3045',
  exchange: 'NSE',
  side: 'BUY',
  quantity: 10,
  approxPrice: 500,
  mode: 'live',
  purpose: 'entry',
}

const okSettings: UserRiskSettingsRow = {
  user_id: 'u1',
  max_daily_loss: 2000,
  max_trades_per_day: 20,
  max_open_positions: 5,
  capital_allocation_limit: 100_000,
  kill_switch_active: false,
  updated_at: '',
}

const okCounter: DailyRiskCounterRow = {
  user_id: 'u1',
  trading_date: '2026-07-24',
  realized_pnl: 0,
  trades_count: 0,
  is_blocked: false,
  blocked_reason: null,
  updated_at: '',
}

type GateInput = Parameters<typeof evaluateGate>[0]

function gate(over: {
  intent?: Partial<OrderIntent>
  settings?: UserRiskSettingsRow | null
  counter?: DailyRiskCounterRow | null
  openLivePositions?: number
  deployedLiveCapital?: number
  brokerStatus?: string | null
}) {
  const input: GateInput = {
    intent: { ...baseIntent, ...(over.intent ?? {}) },
    settings: over.settings === undefined ? okSettings : over.settings,
    counter: over.counter === undefined ? okCounter : over.counter,
    openLivePositions: over.openLivePositions ?? 0,
    deployedLiveCapital: over.deployedLiveCapital ?? 0,
    brokerStatus: over.brokerStatus === undefined ? 'connected' : over.brokerStatus,
  }
  return evaluateGate(input)
}

/* ── riskTradingDate (IST calendar) ── */

describe('riskTradingDate', () => {
  it('follows the IST calendar, not UTC', () => {
    expect(riskTradingDate(new Date('2026-07-24T14:00:00.000Z'))).toBe('2026-07-24') // 19:30 IST
    expect(riskTradingDate(new Date('2026-07-24T04:00:00.000Z'))).toBe('2026-07-24') // 09:30 IST
  })
  it('rolls over exactly at IST midnight (18:30 UTC)', () => {
    expect(riskTradingDate(new Date('2026-07-24T18:29:59.999Z'))).toBe('2026-07-24')
    expect(riskTradingDate(new Date('2026-07-24T18:30:00.000Z'))).toBe('2026-07-25')
  })
  it('handles month boundaries', () => {
    expect(riskTradingDate(new Date('2026-03-31T18:30:00.000Z'))).toBe('2026-04-01')
  })
})

/* ── 1. sanity ── */

describe('gate: sanity (INVALID_ORDER)', () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('rejects quantity %s', (qty) => {
    expect(gate({ intent: { quantity: qty } }).code).toBe('INVALID_ORDER')
  })
  it.each([0, -100, Number.NaN])('rejects approxPrice %s', (px) => {
    expect(gate({ intent: { approxPrice: px } }).code).toBe('INVALID_ORDER')
  })
  it('rejects missing instrument identity', () => {
    expect(gate({ intent: { symbol: '' } }).code).toBe('INVALID_ORDER')
    expect(gate({ intent: { symbolToken: '' } }).code).toBe('INVALID_ORDER')
  })
  it('sanity applies to exits too', () => {
    expect(gate({ intent: { purpose: 'exit', side: 'SELL', quantity: 0 } }).code).toBe('INVALID_ORDER')
  })
  it('sanity precedes broker-connectivity checks', () => {
    const d = gate({ intent: { quantity: 0 }, brokerStatus: 'token_expired' })
    expect(d.code).toBe('INVALID_ORDER')
  })
})

/* ── 2. broker connectivity (live) ── */

describe('gate: BROKER_NOT_CONNECTED', () => {
  it.each(['token_expired', 'disconnected', 'invalid_credentials', null])('blocks live entry when broker is %s', (status) => {
    const d = gate({ brokerStatus: status })
    expect(d).toMatchObject({ approved: false, code: 'BROKER_NOT_CONNECTED' })
  })
  it('blocks live EXITS too when the broker is unreachable (cannot reduce risk without it)', () => {
    const d = gate({ intent: { purpose: 'exit', side: 'SELL' }, brokerStatus: 'token_expired' })
    expect(d.code).toBe('BROKER_NOT_CONNECTED')
  })
  it('paper mode never requires a broker', () => {
    expect(gate({ intent: { mode: 'paper' }, brokerStatus: null }).approved).toBe(true)
  })
})

/* ── 3. exit fast-path (§3.7: exits are never risk-blocked) ── */

describe('gate: exits are never blocked by risk controls', () => {
  const exit = { purpose: 'exit', side: 'SELL' } as const
  it('live exit passes with kill switch ON', () => {
    expect(gate({ intent: exit, settings: { ...okSettings, kill_switch_active: true } }).approved).toBe(true)
  })
  it('live exit passes when daily-loss block is flagged', () => {
    expect(gate({ intent: exit, counter: { ...okCounter, is_blocked: true, blocked_reason: 'x' } }).approved).toBe(true)
  })
  it('live exit passes when every limit is breached', () => {
    expect(
      gate({
        intent: exit,
        counter: { ...okCounter, realized_pnl: -50_000, trades_count: 500 },
        openLivePositions: 99,
        deployedLiveCapital: 9_000_000,
      }).approved,
    ).toBe(true)
  })
  it('live exit passes even with no risk settings configured', () => {
    expect(gate({ intent: exit, settings: null }).approved).toBe(true)
  })
  it('paper exit passes with no broker, no settings, kill switch on… nothing configured at all', () => {
    expect(gate({ intent: { ...exit, mode: 'paper' }, settings: null, counter: null, brokerStatus: null }).approved).toBe(true)
  })
})

/* ── 4. kill switch ── */

describe('gate: KILL_SWITCH', () => {
  it('blocks live entries', () => {
    expect(gate({ settings: { ...okSettings, kill_switch_active: true } }).code).toBe('KILL_SWITCH')
  })
  it('blocks PAPER entries too (parity: paper proves live behavior)', () => {
    expect(gate({ intent: { mode: 'paper' }, settings: { ...okSettings, kill_switch_active: true } }).code).toBe('KILL_SWITCH')
  })
})

/* ── 5. daily-loss block + live config ── */

describe('gate: daily-loss limit', () => {
  it('counter-flagged block stops entries in BOTH modes', () => {
    const blocked = { ...okCounter, is_blocked: true, blocked_reason: 'realized -2500 vs 2000' }
    expect(gate({ counter: blocked }).code).toBe('DAILY_LOSS_LIMIT')
    expect(gate({ intent: { mode: 'paper' }, counter: blocked }).code).toBe('DAILY_LOSS_LIMIT')
  })
  it('live entry pre-check blocks when realized loss reaches the limit exactly (≤)', () => {
    expect(gate({ counter: { ...okCounter, realized_pnl: -2000 } }).code).toBe('DAILY_LOSS_LIMIT')
    expect(gate({ counter: { ...okCounter, realized_pnl: -2500.5 } }).code).toBe('DAILY_LOSS_LIMIT')
  })
  it('a loss just short of the limit still trades', () => {
    expect(gate({ counter: { ...okCounter, realized_pnl: -1999.99 } }).approved).toBe(true)
  })
  it('paper entries ignore realized-PnL counters (live-scoped accounting)', () => {
    expect(gate({ intent: { mode: 'paper' }, counter: { ...okCounter, realized_pnl: -50_000 } }).approved).toBe(true)
  })
})

describe('gate: RISK_NOT_CONFIGURED (live requires limits)', () => {
  it('live entry blocked with no settings row at all', () => {
    expect(gate({ settings: null }).code).toBe('RISK_NOT_CONFIGURED')
  })
  it('live entry blocked with settings but no max_daily_loss', () => {
    expect(gate({ settings: { ...okSettings, max_daily_loss: null } }).code).toBe('RISK_NOT_CONFIGURED')
  })
  it('paper entry approved in the same states', () => {
    expect(gate({ intent: { mode: 'paper' }, settings: null }).approved).toBe(true)
    expect(gate({ intent: { mode: 'paper' }, settings: { ...okSettings, max_daily_loss: null } }).approved).toBe(true)
  })
  it('kill switch beats RISK_NOT_CONFIGURED …', () => {
    expect(gate({ settings: { ...okSettings, max_daily_loss: null, kill_switch_active: true } }).code).toBe('KILL_SWITCH')
  })
  it('…but without settings there is no kill switch to trip', () => {
    expect(gate({ settings: null }).code).toBe('RISK_NOT_CONFIGURED')
  })
})

/* ── 6–8. trades/day, open positions, capital ── */

describe('gate: trades/day, open positions, capital', () => {
  it('MAX_TRADES_PER_DAY at the boundary (live)', () => {
    expect(gate({ counter: { ...okCounter, trades_count: 20 } }).code).toBe('MAX_TRADES_PER_DAY')
    expect(gate({ counter: { ...okCounter, trades_count: 19 } }).approved).toBe(true)
  })
  it('trade counter does not gate paper', () => {
    expect(gate({ intent: { mode: 'paper' }, counter: { ...okCounter, trades_count: 999 } }).approved).toBe(true)
  })
  it('MAX_OPEN_POSITIONS at the boundary (live)', () => {
    expect(gate({ openLivePositions: 5 }).code).toBe('MAX_OPEN_POSITIONS')
    expect(gate({ openLivePositions: 4 }).approved).toBe(true)
  })
  it('open-position count does not gate paper', () => {
    expect(gate({ intent: { mode: 'paper' }, openLivePositions: 100 }).approved).toBe(true)
  })
  it('CAPITAL_LIMIT: projected notional fits exactly → approved (strict >)', () => {
    // deployed 95,000 + 10 × ₹500 = ₹100,000 == limit
    expect(gate({ deployedLiveCapital: 95_000 }).approved).toBe(true)
  })
  it('CAPITAL_LIMIT: ₹1 over the limit → blocked', () => {
    expect(gate({ deployedLiveCapital: 95_001 }).code).toBe('CAPITAL_LIMIT')
  })
  it('capital limit does not gate paper', () => {
    expect(gate({ intent: { mode: 'paper', quantity: 100_000, approxPrice: 1000 }, deployedLiveCapital: 9_000_000 }).approved).toBe(true)
  })
})

/* ── 9. happy paths ── */

describe('gate: approvals', () => {
  it('live entry, fully configured, clean counters', () => {
    expect(gate({})).toEqual({ approved: true })
  })
  it('paper entry with nothing configured survives (paper needs no limits, no broker)', () => {
    expect(gate({ intent: { mode: 'paper' }, settings: null, counter: null, brokerStatus: null }).approved).toBe(true)
  })
})

/* ── authorizeOrder: store wiring + §3.9 notification side effects ── */

describe('authorizeOrder', () => {
  beforeEach(() => vi.clearAllMocks())

  interface Calls {
    settings: number
    counterDates: string[]
    openPositions: number
    capital: number
    broker: number
  }
  function fakeStore(over: Partial<RiskStore> = {}): RiskStore & { calls: Calls } {
    const calls: Calls = { settings: 0, counterDates: [], openPositions: 0, capital: 0, broker: 0 }
    const store: RiskStore = {
      async getSettings() {
        calls.settings++
        return okSettings
      },
      async getCounter(_userId, date) {
        calls.counterDates.push(date)
        return okCounter
      },
      async countOpenLivePositions() {
        calls.openPositions++
        return 0
      },
      async deployedLiveCapital() {
        calls.capital++
        return 0
      },
      async getBrokerStatus() {
        calls.broker++
        return 'connected'
      },
      async bumpCounters() {
        return okCounter
      },
      async setBlocked() {},
      async clearBlocked() {},
      async deactivateLiveStrategies() {
        return []
      },
      ...over,
    }
    return Object.assign(store, { calls })
  }

  it('fetches all five inputs and approves a clean live entry', async () => {
    const store = fakeStore()
    const d = await authorizeOrder(baseIntent, store)
    expect(d.approved).toBe(true)
    expect(store.calls.settings).toBe(1)
    expect(store.calls.openPositions).toBe(1)
    expect(store.calls.capital).toBe(1)
    expect(store.calls.broker).toBe(1)
    expect(store.calls.counterDates).toEqual([riskTradingDate()]) // IST trading day
    expect(notify).not.toHaveBeenCalled() // approvals are silent — fills notify via the order router
  })

  it('blocked entries return the decision + fire §3.9 notification and audit trail', async () => {
    const store = fakeStore({
      async getSettings() {
        return { ...okSettings, kill_switch_active: true }
      },
    })
    const d = await authorizeOrder(baseIntent, store)
    expect(d).toMatchObject({ approved: false, code: 'KILL_SWITCH' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      'u1',
      'order_rejected',
      expect.stringContaining('KILL_SWITCH'),
      expect.stringContaining('TestStrategy'),
    )
    expect(auditLog).toHaveBeenCalledWith('u1', 'risk.order_blocked', expect.objectContaining({ code: 'KILL_SWITCH', mode: 'live' }))
  })

  it('blocked-ENTRY notifications are throttled per user+code (15 min), never spamming hot loops', async () => {
    const store = fakeStore({
      async getSettings() {
        return { ...okSettings, max_trades_per_day: 1 }
      },
      async getCounter() {
        return { ...okCounter, trades_count: 5 }
      },
    })
    const intent = { ...baseIntent, userId: 'u-throttle' }
    expect((await authorizeOrder(intent, store)).code).toBe('MAX_TRADES_PER_DAY')
    expect((await authorizeOrder(intent, store)).code).toBe('MAX_TRADES_PER_DAY')
    expect(notify).toHaveBeenCalledTimes(1) // second block within the window: decision returned, no re-notify
  })

  it('blocked EXITS skip notifications (only connectivity/sanity can block them, and those surface in the worker)', async () => {
    // an exit can only be blocked by sanity or broker-connectivity; assert neither path notifies
    const store = fakeStore({
      async getBrokerStatus() {
        return 'token_expired'
      },
    })
    const d = await authorizeOrder({ ...baseIntent, purpose: 'exit', side: 'SELL' }, store)
    expect(d.code).toBe('BROKER_NOT_CONNECTED')
    expect(notify).not.toHaveBeenCalled()
  })

  it('paper entry consults the same inputs (identical decision table across modes)', async () => {
    const store = fakeStore()
    const d = await authorizeOrder({ ...baseIntent, mode: 'paper' }, store)
    expect(d.approved).toBe(true)
    expect(store.calls.settings + store.calls.openPositions + store.calls.capital + store.calls.broker).toBe(4)
  })
})
