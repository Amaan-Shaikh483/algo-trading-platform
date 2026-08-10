/**
 * Step-7 verification harness — risk manager (§3.7) + live-engine primitives (§3.6).
 *
 * Runs fully offline:
 *   1. evaluateGate — the PURE risk decision matrix (every spec §3.7 check)
 *   2. recordClosedTrade / recordAuthorizedTrade — daily-loss auto-pause with a
 *      mock RiskStore (verifies block-flag flip + live-strategy deactivation)
 *   3. CandleAggregator — IST bucket alignment, close semantics, session filter
 *   4. normalizeTick — SmartAPI WS-v2 stringly ticks, paise → ₹ conversion
 *   5. STRUCTURAL AUDIT: scans src/ to prove no code path can reach a broker
 *      order without passing the risk manager (the user-override invariant).
 *
 * Usage (from backend/):  npm run build && node scripts/verify-live.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Offline Supabase stubs — notify/auditLog writes fail-soft by design.
process.env.SUPABASE_URL ??= 'https://offline.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'offline-key'

const require = createRequire(import.meta.url)
const { evaluateGate, recordClosedTrade, recordAuthorizedTrade, riskTradingDate } = require('../dist/services/risk/riskManager')
const { CandleAggregator, bucketStartFor, MARKET_OPEN_MIN } = require('../dist/services/live/candleAggregator')
const { normalizeTick } = require('../dist/services/live/marketFeedManager')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const BASE_INTENT = {
  userId: 'u1',
  strategyId: 's1',
  strategyName: 'Test Strat',
  symbol: 'SBIN-EQ',
  symbolToken: '3045',
  exchange: 'NSE',
  side: 'BUY',
  quantity: 10,
  approxPrice: 500,
  mode: 'paper',
  purpose: 'entry',
}
const SETTINGS = {
  user_id: 'u1', max_daily_loss: 5000, max_trades_per_day: 10, max_open_positions: 3,
  capital_allocation_limit: 100000, kill_switch_active: false, updated_at: '',
}
const COUNTER = { user_id: 'u1', trading_date: '2026-07-24', realized_pnl: 0, trades_count: 0, is_blocked: false, blocked_reason: null, updated_at: '' }
function gate(intentPatch = {}, ctxPatch = {}) {
  return evaluateGate({
    intent: { ...BASE_INTENT, ...intentPatch },
    settings: SETTINGS,
    counter: COUNTER,
    openLivePositions: 0,
    deployedLiveCapital: 0,
    brokerStatus: 'connected',
    ...ctxPatch,
  })
}

// ── A. risk gate decision matrix ─────────────────────────────────────────────
console.log('\n■ risk gate (evaluateGate)')
{
  check('baseline paper entry approved', gate().approved)
  check('baseline live entry approved', gate({ mode: 'live' }).approved)
  check('zero quantity rejected', !gate({ quantity: 0 }).approved && gate({ quantity: 0 }).code === 'INVALID_ORDER')
  check('zero price rejected', gate({ approxPrice: 0 }).code === 'INVALID_ORDER')
  check('missing token rejected', gate({ symbolToken: '' }).code === 'INVALID_ORDER')

  check('kill switch blocks live entry', gate({ mode: 'live' }, { settings: { ...SETTINGS, kill_switch_active: true } }).code === 'KILL_SWITCH')
  check('kill switch blocks paper entry', gate({}, { settings: { ...SETTINGS, kill_switch_active: true } }).code === 'KILL_SWITCH')
  check(
    'exit is NEVER blocked by the kill switch',
    gate({ purpose: 'exit', side: 'SELL', mode: 'live' }, { settings: { ...SETTINGS, kill_switch_active: true } }).approved,
  )
  check('exit under daily block still approved', gate({ purpose: 'exit', side: 'SELL' }, { counter: { ...COUNTER, is_blocked: true, blocked_reason: 'x' } }).approved)

  check('daily block flag blocks entries', gate({}, { counter: { ...COUNTER, is_blocked: true, blocked_reason: 'loss limit' } }).code === 'DAILY_LOSS_LIMIT')
  check(
    'live pre-check on breach (counter past limit, not yet flagged)',
    gate({ mode: 'live' }, { counter: { ...COUNTER, realized_pnl: -6000 } }).code === 'DAILY_LOSS_LIMIT',
  )
  check(
    'breach pre-check is LIVE-only (paper entry unaffected)',
    gate({}, { counter: { ...COUNTER, realized_pnl: -6000 } }).approved,
  )
  check('live without any settings → RISK_NOT_CONFIGURED', gate({ mode: 'live' }, { settings: null }).code === 'RISK_NOT_CONFIGURED')
  check(
    'live without max_daily_loss → RISK_NOT_CONFIGURED',
    gate({ mode: 'live' }, { settings: { ...SETTINGS, max_daily_loss: null } }).code === 'RISK_NOT_CONFIGURED',
  )
  check('live requires Connected broker (entry)', gate({ mode: 'live' }, { brokerStatus: 'token_expired' }).code === 'BROKER_NOT_CONNECTED')
  check('live requires Connected broker (exit)', gate({ mode: 'live', purpose: 'exit', side: 'SELL' }, { brokerStatus: 'disconnected' }).code === 'BROKER_NOT_CONNECTED')
  check('paper entry allowed without broker (LTP ref supplied by runtime)', gate({}, { brokerStatus: null }).approved)

  check(
    'max trades/day blocks at limit',
    gate({ mode: 'live' }, { counter: { ...COUNTER, trades_count: 10 } }).code === 'MAX_TRADES_PER_DAY',
  )
  check(
    'max trades/day is live-scope (paper unaffected)',
    gate({}, { counter: { ...COUNTER, trades_count: 10 } }).approved,
  )
  check(
    'max open positions blocks at limit',
    gate({ mode: 'live' }, { openLivePositions: 3 }).code === 'MAX_OPEN_POSITIONS',
  )
  check(
    'capital limit blocks when notional would exceed',
    gate({ mode: 'live', quantity: 100, approxPrice: 500 }, { deployedLiveCapital: 95000 }).code === 'CAPITAL_LIMIT',
  )
  check(
    'capital limit allows within headroom',
    gate({ mode: 'live', quantity: 10, approxPrice: 500 }, { deployedLiveCapital: 90000 }).approved,
  )
}

// ── B. counters + daily-loss auto-pause (mock store) ─────────────────────────
console.log('\n■ recordClosedTrade → §3.7 auto-pause (mock store)')
{
  const calls = { setBlocked: [], deactivated: 0, bumps: [] }
  const counterRow = { ...COUNTER, realized_pnl: -6200.5 }
  const store = {
    getSettings: async () => SETTINGS,
    getCounter: async () => ({ ...COUNTER }),
    countOpenLivePositions: async () => 0,
    deployedLiveCapital: async () => 0,
    getBrokerStatus: async () => 'connected',
    bumpCounters: async (u, d, realized, trades) => {
      calls.bumps.push({ realized, trades })
      if (realized !== 0) return { ...counterRow }
      return { ...COUNTER, trades_count: COUNTER.trades_count + trades }
    },
    setBlocked: async (u, d, reason) => { calls.setBlocked.push(reason) },
    clearBlocked: async () => {},
    deactivateLiveStrategies: async () => { calls.deactivated++; return ['StratA', 'StratB'] },
  }
  const r1 = await recordClosedTrade('u1', -6200.5, store)
  check('breach triggers auto-pause', r1.autoPaused === true)
  check('today flagged blocked with the limit reason', calls.setBlocked.length === 1 && calls.setBlocked[0].includes('6200.5'))
  check('all live strategies deactivated', calls.deactivated === 1)
  check('pnl delta forwarded atomically', calls.bumps.length === 1 && calls.bumps[0].realized === -6200.5 && calls.bumps[0].trades === 0)

  calls.bumps.length = 0
  const r2 = await recordClosedTrade('u1', -100, { ...store, bumpCounters: async () => ({ ...counterRow, is_blocked: true }), setBlocked: async () => { calls.setBlocked.push('again') }, deactivateLiveStrategies: async () => { calls.deactivated++; return [] } })
  check('already-blocked day does not double-pause', r2.autoPaused === false)

  const r3 = await recordClosedTrade('u1', 250, { ...store, bumpCounters: async () => ({ ...COUNTER, realized_pnl: 250 }) })
  check('winning day never pauses', r3.autoPaused === false)

  const r4 = await recordClosedTrade('u1', -9999, { ...store, getSettings: async () => ({ ...SETTINGS, max_daily_loss: null }), bumpCounters: async () => ({ ...COUNTER, realized_pnl: -9999 }) })
  check('no limit configured → no auto-pause', r4.autoPaused === false)

  const bumpCalls = []
  await recordAuthorizedTrade('u1', { ...store, bumpCounters: async (u, d, real, tr) => { bumpCalls.push(tr); return { ...COUNTER } } })
  check('authorized live entry increments trade counter once', bumpCalls.length === 1 && bumpCalls[0] === 1)
}

// ── C. IST risk day boundary ─────────────────────────────────────────────────
console.log('\n■ IST calendar boundaries')
{
  check('18:29:59 UTC still same IST day', riskTradingDate(new Date('2026-07-24T18:29:59Z')) === '2026-07-24')
  check('18:30:00 UTC rolls to next IST day', riskTradingDate(new Date('2026-07-24T18:30:00Z')) === '2026-07-25')
}

// ── D. candle aggregation ────────────────────────────────────────────────────
console.log('\n■ candle aggregator (IST buckets)')
{
  const IST = (day, hhmmss) => Date.parse(`${day}T${hhmmss}+05:30`)
  const closes = []
  const agg = new CandleAggregator('5m', (c) => closes.push(c))
  agg.addTick(IST('2026-07-24', '09:14:59'), 100, 10) // pre-market — ignored
  agg.addTick(IST('2026-07-24', '09:15:03'), 100.5, 10)
  agg.addTick(IST('2026-07-24', '09:15:40'), 101.2, 5)
  agg.addTick(IST('2026-07-24', '09:16:10'), 99.8, 8)
  check('no close inside the bucket', closes.length === 0)
  agg.addTick(IST('2026-07-24', '09:20:01'), 100.9, 4) // first tick of next bucket → close
  check('bucket closes on first foreign-bucket tick', closes.length === 1)
  const c1 = closes[0]
  check(
    'aggregated OHLCV correct',
    c1.open === 100.5 && c1.high === 101.2 && c1.low === 99.8 && c1.close === 99.8 && c1.volume === 23 &&
      c1.time.getTime() === IST('2026-07-24', '09:15:00'),
    JSON.stringify(c1),
  )
  agg.addTick(IST('2026-07-24', '09:24:50'), 101.5, 2)
  agg.sweep(IST('2026-07-24', '09:25:00')) // bucket end crossed, no new tick needed
  check('sweep closes the elapsed bucket (handles illiquid bars)', closes.length === 2 && closes[1].volume === 6)

  agg.addTick(IST('2026-07-24', '09:31:00'), 100, 1)
  agg.addTick(IST('2026-07-24', '09:31:30'), 100.3, 1)
  agg.addTick(IST('2026-07-24', '09:28:00'), 99, 99) // stale (earlier bucket than current) → dropped
  agg.sweep(IST('2026-07-24', '09:35:01'))
  check(
    'stale late tick dropped from the wrong bucket',
    closes.length === 3 && closes[2].open === 100 && closes[2].high === 100.3 && closes[2].low === 100 && closes[2].volume === 2,
    JSON.stringify(closes[2]),
  )

  const day = []
  const aggD = new CandleAggregator('1D', (c) => day.push(c))
  aggD.addTick(IST('2026-07-24', '09:15:01'), 500, 100)
  aggD.addTick(IST('2026-07-24', '15:29:59'), 510, 50)
  aggD.sweep(IST('2026-07-24', '15:29:59'))
  check('1D candle still open before 15:30', day.length === 0)
  aggD.sweep(IST('2026-07-24', '15:30:00'))
  check('1D candle closes at session end', day.length === 1 && day[0].close === 510 && day[0].volume === 150)

  const afterCloses = []
  const aggAfter = new CandleAggregator('1m', (c) => afterCloses.push(c))
  aggAfter.addTick(IST('2026-07-24', '15:31:00'), 505, 5)
  aggAfter.sweep(IST('2026-07-24', '15:35:00'))
  check('after-hours ticks ignored', afterCloses.length === 0)

  check('1h buckets start 09:15 (SmartAPI convention)', bucketStartFor(IST('2026-07-24', '10:20:00'), 60) === IST('2026-07-24', '10:15:00'))
  check('MARKET_OPEN 09:15 constant', MARKET_OPEN_MIN === 555)
}

// ── E. tick normalization (SmartAPI WS v2 wire shape) ────────────────────────
console.log('\n■ tick normalization')
{
  const t = normalizeTick({
    subscription_mode: '2', exchange_type: '1', token: '3045', sequence_number: '12345',
    exchange_timestamp: '1753334700000', last_traded_price: '51235', last_traded_quantity: '40',
    avg_traded_price: '51100', vol_traded: '5000000',
  })
  check('paise → ₹ (÷100)', t && t.price === 512.35)
  check('qty parsed', t && t.qty === 40)
  check('exchange ts used', t && t.ts === 1753334700000)
  check('token string kept', t && t.symbolToken === '3045')
  check('control frame → null', normalizeTick({}) === null && normalizeTick('pong') === null)
  check('zero price → null', normalizeTick({ subscription_mode: '1', token: '3045', last_traded_price: '0' }) === null)
}

// ── F. STRUCTURAL AUDIT — no order bypasses the risk manager ─────────────────
console.log('\n■ structural audit: risk-manager non-bypassability')
{
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
  const files = []
  ;(function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      // *.test.ts excluded: unit suites legitimately invoke the gate/router as
      // test subjects — they are not runtime bypass paths (step 10).
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p)
    }
  })(srcRoot)
  const rel = (p) => path.relative(srcRoot, p)
  const calls = (pattern) => files.flatMap((p) => (readFileSync(p, 'utf8').includes(pattern) ? [rel(p)] : []))

  const placeOrderUsers = calls('.placeOrder(')
  check(
    'broker placeOrder called ONLY inside orderRouter (+ adapter definition)',
    placeOrderUsers.sort().join(',') === 'services/brokers/angelOneService.ts,services/live/orderRouter.ts',
    placeOrderUsers.join(','),
  )
  const routerCallers = calls('executeIntent(')
  check(
    'executeIntent used ONLY by strategyRuntime + killSwitchService (+ router definition)',
    routerCallers.sort().join(',') === 'services/live/orderRouter.ts,services/live/strategyRuntime.ts,services/risk/killSwitchService.ts',
    routerCallers.join(','),
  )
  const gateCallers = calls('authorizeOrder(')
  check(
    'risk gate invoked ONLY by the order router (+ risk manager definition)',
    gateCallers.sort().join(',') === 'services/live/orderRouter.ts,services/risk/riskManager.ts',
    gateCallers.join(','),
  )
  const rmSource = readFileSync(path.join(srcRoot, 'services/risk/riskManager.ts'), 'utf8')
  check('risk manager never touches the broker (pure gate)', !rmSource.includes('placeOrder'))
}

// ── verdict ──────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
