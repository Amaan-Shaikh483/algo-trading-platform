/**
 * Engine behavior verification harness (step 6 — spec §3.5).
 *
 * Runs the compiled backtest engine + indicator runtime against deterministic
 * synthetic candles and asserts the documented execution semantics:
 *   - signals on closed bars, entry fills at signal-bar close
 *   - intra-bar SL/target at trigger price, gap-adjusted to the open
 *   - both-hit-same-bar → stop assumed (conservative)
 *   - trailing stop ratchets at BAR END (established-stop fills on a LATER bar)
 *   - time square-off at first bar ≥ cutoff; no entries at/after cutoff
 *   - maxHoldingBars, maxTradesPerDay per IST day, capital-allocation cap
 *   - flat/percent brokerage per side, adverse slippage per fill
 *   - end-of-data flush; equity/fee arithmetic consistency
 *   - incremental indicator values exactly equal static full-series values
 *
 * Usage (from backend/):  npm run build && node scripts/verify-engine.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ti = require('technicalindicators')
const { IndicatorRuntime, collectIndicatorSpecs } = require('../dist/services/engine/indicatorEngine')
const { runBacktestCore } = require('../dist/services/engine/backtestEngine')

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
function near(a, b, eps = 0.011) {
  return Number.isFinite(a) && Math.abs(a - b) <= eps
}

// ── candle helpers ────────────────────────────────────────────────────────────
/** 1-minute bars, IST wall-clock, from [o,h,l,c] tuples. startDate = UTC ms of an IST midnight. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
function istMidnightUtcMs(y, m, d) {
  return Date.UTC(y, m, d, 0, 0, 0) - IST_OFFSET_MS
}
function candlesFrom(bars, { day = istMidnightUtcMs(2026, 6, 20), startMin = 9 * 60 + 15, stepMin = 1 } = {}) {
  return bars.map(([o, h, l, c], i) => ({
    time: new Date(day + (startMin + i * stepMin) * 60_000),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 10000,
  }))
}

const ALWAYS_LONG = {
  version: 1,
  direction: { side: 'long' },
  entry: { orderType: 'MARKET', productType: 'INTRADAY' },
  entryConditions: {
    combinator: 'and',
    conditions: [{ id: 'c1', left: { kind: 'price', field: 'close' }, operator: 'gt', right: { kind: 'value', value: 0 } }],
  },
  exit: {},
  risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 20 },
}
function rulesWith(patch) {
  const r = structuredClone(ALWAYS_LONG)
  if (patch.direction) r.direction = patch.direction
  if (patch.exit) r.exit = { ...r.exit, ...patch.exit }
  if (patch.risk) r.risk = { ...r.risk, ...patch.risk }
  return r
}
const FREE = { initialCapital: 100000, brokerageType: 'flat', brokerageValue: 0, slippagePercent: 0 }
function run(rules, candles, config = FREE) {
  return runBacktestCore({ rules, candles, config })
}

// ── B1–B4: SL / target mechanics ─────────────────────────────────────────────
console.log('\n■ stop-loss & target fills')
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // entry at close 100, SL 10 → 90
    [100, 101, 89, 99], // low 89 ≤ 90, open above → fill AT stop 90
    [99, 99, 98, 98],
  ])
  const t = run(rulesWith({ exit: { stopLoss: { type: 'points', value: 10 } } }), candles).trades[0]
  check('intra-bar SL fills at SL price', t && t.exitReason === 'stop_loss' && near(t.exitPrice, 90), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100],
    [85, 86, 84, 85], // opens through the 90 stop → fill at open 85
  ])
  const t = run(rulesWith({ exit: { stopLoss: { type: 'points', value: 10 } } }), candles).trades[0]
  check('gap-through SL fills at open', t && t.exitReason === 'stop_loss' && near(t.exitPrice, 85), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // entry 100, SL 10 → 90, target 2R → 120
    [101, 121, 100, 119], // high 121 ≥ 120 → fill at 120
  ])
  const t = run(
    rulesWith({ exit: { stopLoss: { type: 'points', value: 10 }, target: { type: 'rr_multiple', value: 2 } } }),
    candles,
  ).trades[0]
  check('RR target = 2× risk distance, fills at target', t && t.exitReason === 'target' && near(t.exitPrice, 120) && near(t.grossPnl, 20), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100],
    [101, 125, 85, 110], // target 120 AND stop 90 both inside → stop assumed
  ])
  const t = run(
    rulesWith({ exit: { stopLoss: { type: 'points', value: 10 }, target: { type: 'rr_multiple', value: 2 } } }),
    candles,
  ).trades[0]
  check('SL+target in same bar → stop wins (conservative)', t && t.exitReason === 'stop_loss' && near(t.exitPrice, 90) && near(t.grossPnl, -10), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // target 110; bar1 gaps above it → favorable fill at open 115
    [115, 116, 113, 114],
  ])
  const t = run(rulesWith({ exit: { target: { type: 'points', value: 10 } } }), candles).trades[0]
  check('gap past target fills at open (favorable)', t && t.exitReason === 'target' && near(t.exitPrice, 115), JSON.stringify(t))
}

// ── B5–B6: short side + max holding ───────────────────────────────────────────
console.log('\n■ short side & max-holding')
{
  const short = rulesWith({ direction: { side: 'short' }, exit: { stopLoss: { type: 'points', value: 5 }, target: { type: 'points', value: 8 } } })
  const t1 = run(short, candlesFrom([[100, 100.5, 99.5, 100], [99, 100, 91, 93]])).trades[0]
  check('short target fills at target', t1 && t1.side === 'SHORT' && t1.exitReason === 'target' && near(t1.exitPrice, 92) && near(t1.grossPnl, 8), JSON.stringify(t1))
  const t2 = run(short, candlesFrom([[100, 100.5, 99.5, 100], [101, 106, 100, 105]])).trades[0]
  check('short SL fills at stop', t2 && t2.exitReason === 'stop_loss' && near(t2.exitPrice, 105) && near(t2.grossPnl, -5), JSON.stringify(t2))
}
{
  const candles = candlesFrom([
    [100, 100, 99, 100], // entry bar0
    [101, 102, 100, 101], // barsHeld 1
    [102, 103, 101, 103], // barsHeld 2 → exit at this close
    [103, 103, 102, 102],
  ])
  const t = run(rulesWith({ exit: { maxHoldingBars: 2 } }), candles).trades[0]
  check('maxHoldingBars exits on Nth bar at close', t && t.exitReason === 'max_holding' && t.barsHeld === 2 && near(t.exitPrice, 103), JSON.stringify(t))
}
{
  const r = rulesWith({ exit: {} })
  const trades = run(r, candlesFrom([[100, 100.5, 99.5, 100], [104, 105, 103, 104]])).trades
  check('end_of_data flush at last close', trades.length === 1 && trades[0].exitReason === 'end_of_data' && near(trades[0].exitPrice, 104), JSON.stringify(trades[0]))
}

// ── B7–B9: fees & slippage ────────────────────────────────────────────────────
console.log('\n■ fees & slippage')
{
  const candles = candlesFrom([[100, 100.5, 99.5, 100], [104, 105, 103, 104]])
  const res = run(rulesWith({ risk: { quantity: 10 } }), candles, { ...FREE, brokerageValue: 20 })
  const t = res.trades[0]
  check('flat ₹20/side → ₹40 per round trip', t && near(t.fees, 40) && near(t.netPnl, t.grossPnl - 40), JSON.stringify(t))
  check('summary.totalFees = Σ trade fees', near(res.summary.totalFees, 40))
}
{
  const candles = candlesFrom([[100, 100.5, 99.5, 100], [110, 111, 109, 110]])
  const t = run(rulesWith({ risk: { quantity: 10 } }), candles, { ...FREE, brokerageType: 'percent', brokerageValue: 0.05 }).trades[0]
  // entry 100*10=1000 → 0.5 ; exit 110*10=1100 → 0.55
  check('percent brokerage per side on notional', t && near(t.fees, 1.05, 0.001), JSON.stringify(t))
}
{
  const candles = candlesFrom([[100, 100.5, 99.5, 100], [104, 105, 103, 104]])
  const t = run(rulesWith({}), candles, { ...FREE, slippagePercent: 0.1 }).trades[0]
  // entry 100 * 1.001 = 100.1 ; exit 104 * 0.999 = 103.896 (reported rounded to 2dp → 103.9)
  check('slippage adverse on both fills (buy ↑ / sell ↓)', t && near(t.entryPrice, 100.1, 0.001) && near(t.exitPrice, 103.9, 0.001) && t.exitPrice < 104, JSON.stringify(t))
}

// ── B10: risk gates ────────────────────────────────────────────────────────────
console.log('\n■ risk gates')
{
  const r = rulesWith({ exit: { stopLoss: { type: 'points', value: 5 } }, risk: { maxTradesPerDay: 1, quantity: 1 } })
  const dayBars = [
    [100, 100.5, 99.5, 100], // enter 100
    [100, 100, 94, 99], // SL 95 hit → trade 1 for the day; same-bar re-entry attempt is gated → skip
    [99, 100, 98, 99], // signal true but daily limit used → skipped
    [99, 100, 98, 99], // skipped again
  ]
  const day1 = candlesFrom(dayBars, { day: istMidnightUtcMs(2026, 6, 20) })
  const day2 = candlesFrom(dayBars, { day: istMidnightUtcMs(2026, 6, 21) })
  const res = run(r, [...day1, ...day2])
  // 1 trade/day; 3 gated signals/day (the exit bar itself + two following)
  check('maxTradesPerDay blocks re-entry same day, resets next day', res.trades.length === 2 && res.summary.skippedSignals === 6, JSON.stringify({ trades: res.trades.length, skipped: res.summary.skippedSignals }))
}
{
  const r = rulesWith({ risk: { quantity: 200, capitalAllocationPercent: 10 } }) // cap ₹10,000 < notional ₹20,000
  const res = run(r, candlesFrom([[100, 100.5, 99.5, 100], [101, 102, 100, 101]]))
  check('capitalAllocationPercent skips oversized entries', res.trades.length === 0 && res.summary.skippedSignals >= 1, JSON.stringify(res.summary.skippedSignals))
  const res2 = run(rulesWith({ risk: { quantity: 50, capitalAllocationPercent: 10 } }), candlesFrom([[100, 100.5, 99.5, 100], [101, 102, 100, 101]]))
  check('entries within the cap proceed', res2.trades.length === 1)
}

// ── B11: time square-off ───────────────────────────────────────────────────────
console.log('\n■ time square-off (cutoff 09:17)')
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // 09:15 entry at 100
    [101, 101.5, 100.5, 101], // 09:16 below cutoff — held
    [102, 102.5, 101.5, 102], // 09:17 ≥ cutoff → exit at close 102
    [103, 103.5, 102.5, 103], // 09:18 flat; signal past cutoff → skipped
  ])
  const res = run(rulesWith({ exit: { timeSquareOff: { time: '09:17' } } }), candles)
  const t = res.trades[0]
  check('exits on first bar ≥ cutoff, at its close', t && t.exitReason === 'time_squareoff' && near(t.exitPrice, 102) && near(t.grossPnl, 2), JSON.stringify(t))
  // gate blocks the exit bar's same-bar re-entry attempt (09:17) and 09:18's signal
  check('no entries at/after cutoff', res.summary.skippedSignals === 2, String(res.summary.skippedSignals))
}

// ── B12: trailing stop — bar-end ratchet semantics ─────────────────────────────
console.log('\n■ trailing stop (bar-end ratchet)')
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // entry 100; trail 12 → working SL 88
    [130, 151, 129, 150], // low 129 vs SL 88 → held; bar-end: peak 151 → SL 139
    [138, 139, 136, 137], // low 136 ≤ 139, opens through → fill at open 138
  ])
  const t = run(rulesWith({ exit: { trailingStopLoss: { type: 'points', value: 12 } } }), candles).trades[0]
  check(
    'stop established by bar N only fills on a LATER bar (regression)',
    t && t.exitReason === 'trailing_stop' && t.barsHeld === 2 && near(t.exitPrice, 138),
    JSON.stringify(t),
  )
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // entry 100, trail 12 → SL 88
    [101, 120, 100, 118], // held; bar-end peak 120 → SL 108
    [117, 118, 107, 110], // low 107 ≤ 108, no gap → fill AT stop 108
  ])
  const t = run(rulesWith({ exit: { trailingStopLoss: { type: 'points', value: 12 } } }), candles).trades[0]
  check('trailing fill at stop price when no gap', t && t.exitReason === 'trailing_stop' && near(t.exitPrice, 108) && near(t.grossPnl, 8), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // SHORT entry 100, trail 10 → SL 110
    [99, 100, 85, 87], // held; bar-end peak 85 → SL 95
    [88, 96, 87, 90], // high 96 ≥ 95 → fill at stop 95
  ])
  const t = run(rulesWith({ direction: { side: 'short' }, exit: { trailingStopLoss: { type: 'points', value: 10 } } }), candles).trades[0]
  check('short trailing ratchets down and fills at stop', t && t.exitReason === 'trailing_stop' && near(t.exitPrice, 95) && near(t.grossPnl, 5), JSON.stringify(t))
}
{
  const candles = candlesFrom([
    [100, 100.5, 99.5, 100], // trail 12% → distance 12, SL 88 (percent variant)
    [130, 151, 129, 150],
    [138, 139, 136, 137],
  ])
  const t = run(rulesWith({ exit: { trailingStopLoss: { type: 'percent', value: 12 } } }), candles).trades[0]
  check('percent trailing ≡ points at entry-price distance', t && t.exitReason === 'trailing_stop' && near(t.exitPrice, 138), JSON.stringify(t))
}

// ── B13: indicator parity — incremental == static (exact) ─────────────────────
console.log('\n■ indicator parity (incremental vs static full-series)')
{
  const candles = []
  let price = 400
  let t = Date.UTC(2026, 0, 1, 3, 45, 0) // 09:15 IST
  for (let i = 0; i < 2000; i++) {
    const drift = Math.sin(i / 120) * 1.6 + Math.sin(i / 37) * 0.7
    const open = price
    price = Math.max(50, price + drift + Math.cos(i / 11) * 0.3)
    candles.push({ time: new Date(t), open, high: Math.max(open, price) + 0.8 + (i % 3) * 0.2, low: Math.min(open, price) - 0.8 - (i % 2) * 0.2, close: price, volume: 100000 + (i % 7) * 1000 })
    t += 5 * 60 * 1000
  }
  const closes = candles.map((c) => c.close)
  const ema9Static = ti.EMA.calculate({ values: closes, period: 9 })
  const rsi14Static = ti.RSI.calculate({ values: closes, period: 14 })
  const macdStatic = ti.MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })
  const stochStatic = ti.Stochastic.calculate({ high: candles.map((c) => c.high), low: candles.map((c) => c.low), close: closes, period: 14, signalPeriod: 3 })
  const adxStatic = ti.ADX.calculate({ high: candles.map((c) => c.high), low: candles.map((c) => c.low), close: closes, period: 14 })
  const bbStatic = ti.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 })
  const atrStatic = ti.ATR.calculate({ high: candles.map((c) => c.high), low: candles.map((c) => c.low), close: closes, period: 14 })

  const specs = [
    { instanceId: 'ema|period:9', key: 'ema', params: { period: 9 } },
    { instanceId: 'rsi|period:14', key: 'rsi', params: { period: 14 } },
    { instanceId: 'macd|fastPeriod:12,signalPeriod:9,slowPeriod:26', key: 'macd', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
    { instanceId: 'stochastic|period:14,signalPeriod:3', key: 'stochastic', params: { period: 14, signalPeriod: 3 } },
    { instanceId: 'adx|period:14', key: 'adx', params: { period: 14 } },
    { instanceId: 'bollinger|period:20,stdDev:2', key: 'bollinger', params: { period: 20, stdDev: 2 } },
    { instanceId: 'atr|period:14', key: 'atr', params: { period: 14 } },
  ]
  // Static-array ↔ candle alignment (empirically verified against the library):
  // the library emits each result object as soon as ANY output is defined —
  //   EMA(9)        arr[0] ↔ candle 8
  //   RSI/ATR(14)   arr[0] ↔ candle 14
  //   MACD          arr[0] ↔ candle 25 ({MACD} only; signal/histogram appear in arr[8], candle 33)
  //   Stochastic    arr[0] ↔ candle 13 ({k} only; d appears in arr[2], candle 15)
  //   ADX(14)       arr[0] ↔ candle 27
  //   Bollinger(20) arr[0] ↔ candle 19
  const MACD = 'macd|fastPeriod:12,signalPeriod:9,slowPeriod:26'
  const STO = 'stochastic|period:14,signalPeriod:3'
  const BB = 'bollinger|period:20,stdDev:2'
  const rt = new IndicatorRuntime(specs)
  let maxErr = 0
  const err = (a, b) => { if (Number.isFinite(b)) maxErr = Math.max(maxErr, Math.abs(a - b)) }
  let samples = 0
  candles.forEach((c, i) => {
    rt.update(c)
    if (i >= 100 && i % 97 === 0) {
      samples++
      err(rt.value('ema|period:9', 'value'), ema9Static[i - 8])
      err(rt.value('rsi|period:14', 'value'), rsi14Static[i - 14])
      const m = macdStatic[i - 25]
      if (m) {
        err(rt.value(MACD, 'macd'), m.MACD)
        err(rt.value(MACD, 'signal'), m.signal)
        err(rt.value(MACD, 'histogram'), m.histogram)
      }
      const st = stochStatic[i - 13]
      if (st) { err(rt.value(STO, 'k'), st.k); err(rt.value(STO, 'd'), st.d) }
      const ax = adxStatic[i - 27]
      if (ax) { err(rt.value('adx|period:14', 'adx'), ax.adx); err(rt.value('adx|period:14', 'pdi'), ax.pdi); err(rt.value('adx|period:14', 'mdi'), ax.mdi) }
      const bb = bbStatic[i - 19]
      if (bb) { err(rt.value(BB, 'upper'), bb.upper); err(rt.value(BB, 'middle'), bb.middle); err(rt.value(BB, 'lower'), bb.lower); err(rt.value(BB, 'pb'), bb.pb) }
      err(rt.value('atr|period:14', 'value'), atrStatic[i - 14])
    }
  })
  check(`incremental == static exactly (maxErr ${maxErr.toExponential(1)} over ${samples} sampled candles × 14 outputs)`, maxErr === 0 && samples > 0)

  // warmup: undefined before enough data
  const rtWarm = new IndicatorRuntime(specs)
  for (const c of candles.slice(0, 8)) rtWarm.update(c)
  check('warmup returns NaN before enough bars', !Number.isFinite(rtWarm.value('ema|period:9', 'value')) && !Number.isFinite(rtWarm.value('rsi|period:14', 'value')))
}

// VWAP session reset (custom impl — sanity, not parity)
{
  const rt = new IndicatorRuntime([{ instanceId: 'vwap|', key: 'vwap', params: {} }])
  const day1 = candlesFrom([[100, 101, 99, 100], [102, 103, 101, 102]], { day: istMidnightUtcMs(2026, 6, 20) })
  const day2 = candlesFrom([[500, 501, 499, 500]], { day: istMidnightUtcMs(2026, 6, 21) })
  rt.update(day1[0]); rt.update(day1[1]); rt.update(day2[0])
  const v = rt.value('vwap|', 'value')
  check('VWAP resets each IST session', v >= 499 && v <= 501, `day-2 vwap ${v} should reflect only the 500-ish bar`)
}

// crosses_* signal count: engine (incremental, offset-1 lookback) vs static arrays
{
  const { evaluateEntrySignal } = require('../dist/services/engine/ruleEvaluator')
  const candles = []
  let price = 400
  let t = Date.UTC(2026, 0, 1, 3, 45, 0)
  for (let i = 0; i < 4000; i++) {
    const drift = Math.sin(i / 120) * 1.6 + Math.sin(i / 37) * 0.7
    const open = price
    price = Math.max(50, price + drift + Math.cos(i / 11) * 0.3)
    candles.push({ time: new Date(t), open, high: Math.max(open, price) + 0.8 + (i % 3) * 0.2, low: Math.min(open, price) - 0.8 - (i % 2) * 0.2, close: price, volume: 100000 })
    t += 5 * 60 * 1000
  }
  const closes = candles.map((c) => c.close)
  const fast = 3, slow = 8
  const emaF = ti.EMA.calculate({ values: closes, period: fast })
  const emaS = ti.EMA.calculate({ values: closes, period: slow })
  let staticCrosses = 0
  for (let i = 1; i < closes.length; i++) {
    if (emaF[i - fast] <= emaS[i - slow] && emaF[i - fast + 1] > emaS[i - slow + 1]) staticCrosses++
  }
  const crossRules = {
    version: 1, direction: { side: 'long' }, entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: { combinator: 'and', conditions: [{ id: 'c1', left: { kind: 'indicator', indicator: 'ema', params: { period: fast }, output: 'value' }, operator: 'crosses_above', right: { kind: 'indicator', indicator: 'ema', params: { period: slow }, output: 'value' } }] },
    exit: {}, risk: { quantity: 1, maxConcurrentPositions: 1, maxTradesPerDay: 20 },
  }
  const rt = new IndicatorRuntime(collectIndicatorSpecs(crossRules))
  let engineSignals = 0
  candles.forEach((c, i) => {
    rt.update(c)
    if (evaluateEntrySignal(crossRules, { current: c, previous: i > 0 ? candles[i - 1] : undefined, runtime: rt })) engineSignals++
  })
  check(`crosses_above count: engine (${engineSignals}) == static (${staticCrosses})`, engineSignals === staticCrosses && staticCrosses > 0)

  let staticBelow = 0
  for (let i = 1; i < closes.length; i++) {
    if (emaF[i - fast] >= emaS[i - slow] && emaF[i - fast + 1] < emaS[i - slow + 1]) staticBelow++
  }
  const belowRules = structuredClone(crossRules)
  belowRules.entryConditions.conditions[0].operator = 'crosses_below'
  const rt2 = new IndicatorRuntime(collectIndicatorSpecs(belowRules))
  let engineBelow = 0
  candles.forEach((c, i) => {
    rt2.update(c)
    if (evaluateEntrySignal(belowRules, { current: c, previous: i > 0 ? candles[i - 1] : undefined, runtime: rt2 })) engineBelow++
  })
  check(`crosses_below count: engine (${engineBelow}) == static (${staticBelow})`, engineBelow === staticBelow && staticBelow > 0)
}

// ── B14: full-run arithmetic consistency on synthetic data ────────────────────
console.log('\n■ full-run consistency')
{
  const candles = []
  let price = 400
  let t = Date.UTC(2026, 0, 1, 3, 45, 0)
  for (let i = 0; i < 4000; i++) {
    const drift = Math.sin(i / 120) * 1.6 + Math.sin(i / 37) * 0.7
    const open = price
    price = Math.max(50, price + drift + Math.cos(i / 11) * 0.3)
    candles.push({ time: new Date(t), open, high: Math.max(open, price) + 0.8 + (i % 3) * 0.2, low: Math.min(open, price) - 0.8 - (i % 2) * 0.2, close: price, volume: 100000 })
    t += 5 * 60 * 1000
  }
  const rules = {
    version: 1,
    direction: { side: 'long' },
    entry: { orderType: 'MARKET', productType: 'INTRADAY' },
    entryConditions: {
      combinator: 'and',
      conditions: [
        { id: 'c1', left: { kind: 'indicator', indicator: 'ema', params: { period: 9 }, output: 'value' }, operator: 'crosses_above', right: { kind: 'indicator', indicator: 'ema', params: { period: 21 }, output: 'value' } },
        { id: 'c2', left: { kind: 'indicator', indicator: 'rsi', params: { period: 14 }, output: 'value' }, operator: 'gt', right: { kind: 'value', value: 40 } },
      ],
    },
    exit: { stopLoss: { type: 'points', value: 25 }, target: { type: 'rr_multiple', value: 2 }, timeSquareOff: { time: '15:15' } },
    risk: { quantity: 10, maxConcurrentPositions: 1, maxTradesPerDay: 20 },
  }
  const res = run(rules, candles, { initialCapital: 100000, brokerageType: 'flat', brokerageValue: 20, slippagePercent: 0.05 })
  const s = res.summary
  // this synthetic series is strongly trending (400→836): only ~7 cross signals total,
  // some landing in-position or past the 15:15 cutoff — so a handful of trades is CORRECT.
  check('produces trades on indicator-driven rules', res.trades.length >= 2 && res.trades.length <= 8, `trades=${res.trades.length}`)
  let arith = true
  for (const tr of res.trades) {
    const gross = tr.side === 'LONG' ? (tr.exitPrice - tr.entryPrice) * tr.quantity : (tr.entryPrice - tr.exitPrice) * tr.quantity
    if (Math.abs(gross - tr.grossPnl) > 0.51 || Math.abs(tr.grossPnl - tr.fees - tr.netPnl) > 0.02) arith = false
  }
  check('per-trade arithmetic (gross − fees = net)', arith)
  check('Σ netPnl == summary.totalNetPnl', near(res.trades.reduce((a, x) => a + x.netPnl, 0), s.totalNetPnl, 1))
  check('initial + netPnl == finalEquity', near(s.initialCapital + s.totalNetPnl, s.finalEquity, 1))
  check('wins + losses == totalTrades', s.wins + s.losses === s.totalTrades)
  check('equity curve downsampled ≤ 1600 points but ends at final bar', res.equityCurve.length <= 1600 && res.equityCurve[res.equityCurve.length - 1].t === candles[candles.length - 1].time.toISOString())
  check('drawdown curve aligned with equity curve', res.drawdownCurve.length === res.equityCurve.length && res.drawdownCurve.every((p) => p.drawdown >= 0))
  const istMinOf = (iso) => { const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS); return d.getUTCHours() * 60 + d.getUTCMinutes() }
  const cutoff = 15 * 60 + 15 // 15:15 IST
  check(
    'every trade enters before and exits at/before the 15:15 IST cutoff bar',
    res.trades.every((tr) => istMinOf(tr.entryTime) < cutoff && istMinOf(tr.exitTime) <= cutoff),
  )
  console.log(`    · stats: trades=${s.totalTrades} net=₹${s.totalNetPnl} winRate=${s.winRate}% pf=${s.profitFactor} maxDD=₹${s.maxDrawdown} sharpe=${s.sharpeDaily} exposure=${s.exposurePct}%`)
  console.log(`    · exit mix: ${[...new Set(res.trades.map((x) => x.exitReason))].join(', ')}`)
}

// ── verdict ────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
