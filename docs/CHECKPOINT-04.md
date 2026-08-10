# Checkpoint 04 — Step 6: Backtesting Engine (§3.5)

Status: **complete, awaiting review.**
Verified: backend typecheck ✅ · engine behavior harness **35/35 ✅**
(`cd backend && npm run verify:engine`) · indicator parity incremental vs
static **maxErr 0.0** (7 indicators × 14 outputs) ✅ · frontend build ✅
(2431 modules).

## What was built

### 1. `engine/` — the shared execution core (backend/src/services/engine/)
Three modules, all consuming `@algo/rule-schema` so backtest ↔ live parity is
structural (step 7's live worker will import the same files):

- **`indicatorEngine.ts` — incremental indicator runtime.** Every indicator
  updates bar-by-bar via `nextValue`/custom state machines instead of
  recomputing the whole series (spec §3.5 requirement + matches how the live
  engine must compute). `technicalindicators@3.1.0`; **Supertrend is a custom
  implementation** (missing from the package), **VWAP is custom with IST
  session reset**. Compounds share one instance per
  (indicator,params,timeframe) spec; `value(id, output, offset)` supports the
  offset-1 lookback `crosses_above/below` need.
- **`ruleEvaluator.ts` — pure condition evaluation** (operands: indicator /
  price field / constant; operators incl. crosses with previous-bar lookback).
- **`backtestEngine.ts` — `runBacktestCore(rules, candles, config)`** bar-by-bar
  replay producing trades, equity curve, drawdown series, and 21 summary stats.
  Documented execution model:
  - signals on **closed bars**, entry at the signal bar's **close** (a market
    order at candle close fills within a tick);
  - SL / target / trailing fill **intra-bar at the trigger price**,
    **gap-adjusted to the open** when the bar opens through the level; both-hit
    in one bar → **stop assumed** (conservative); gap past target fills at open
    (favorable slippage is real: a limit order fills at market);
  - **trailing stops ratchet at BAR END** — the stop a bar establishes can only
    fill on a *later* bar (intra-bar sequencing is unknowable from OHLC);
  - gates: `maxTradesPerDay` per IST day, `capitalAllocationPercent` (skip if
    notional exceeds cap), **no entries at/after the time-square-off cutoff**,
    square-off at first bar ≥ cutoff, `maxHoldingBars`, end-of-data flush;
  - brokerage flat ₹/side or %/side on notional; slippage % **adverse** per
    fill; fees in P&L per trade and in summary;
  - stats: total/net P&L, return %, wins/losses, win rate, avg win/loss,
    **profit factor**, expectancy, largest win/loss, max DD (₹ + %),
    **Sharpe-like (daily equity returns, √252-annualized)**, total fees,
    skipped signals, exposure %, candles processed; equity/drawdown curves
    downsampled to ≤1600 points with the final bar always included.

### 2. `backtestService.ts` — async job pipeline (spec §3.5 "background job with
progress + completion notification")
- Historical fetch via the user's own broker session
  (`getSessionAdapterForUser` — throws `BROKER_NOT_CONNECTED`; AG8001 session
  expiry auto-recovers via stored refresh token) with **chunked requests**:
  per-interval limits verified against Angel One's official release note,
  applied with a 1-day margin (1m 29d / 3m 59d / 5m 99d / 10m 99d / 15m 199d /
  30m 199d / 1h 399d / 1D 1999d), then **stitched + deduped by timestamp** and
  rate-limited through the shared 3/s historical limiter.
- `backtest_runs` table doubles as the queue: insert `queued` → **optimistic
  claim** (queued→running guarded update) → process → store `result` JSON +
  progress updates (chunks done/total) → **notification row on completion**
  (spec §3.9 channel already wired). `POST /api/backtests` kicks the drain
  in-process for instant starts; `drainQueue()` re-claims orphans after a crash.
- Fair-use guards: ≤2-year range, ₹1,000–₹10Cr capital, sane brokerage/slippage
  bounds, **25 runs/day/user**.

### 3. Routes & jobs
- `GET /api/backtests` (list w/o result payload), `GET /:id`,
  `POST /` → `202 Accepted` + run row, `DELETE /:id`.
- `POST /internal/jobs/run-backtests` (cron-secret) + new **`run-backtests`
  edge function** (thin forwarder) + every-minute cron entry in
  `supabase/CRON_SETUP.md`.

### 4. Frontend — Backtest page (spec §3.5 results screen)
- **Run form:** strategy picker, range chips 1M/3M/6M/1Y/custom (IST date
  inputs), initial capital, brokerage flat-%+/per-side model, slippage %,
  client-side validation mirroring backend limits.
- **Runs list:** status badges (Queued/Running/Completed/Failed), live
  progress bar, failure reason, delete; **2.5 s auto-polling** while any run is
  active.
- **Results:** 10 stat cards (net P&L, win rate, profit factor, max DD,
  trades/skipped/exposure, expectancy, largest win/loss, Sharpe, fees, final
  equity); **Recharts equity + drawdown charts** with IST axes and ₹ L/k
  formatting; **trade log with sortable columns, side/exit-reason/outcome
  filters, and CSV export** of the filtered view; honest-disclaimer footer
  describing the execution model.

## Verification — `backend/scripts/verify-engine.mjs` (35 checks, all green)
- **Indicator parity:** incremental runtime == static full-series for EMA, RSI,
  MACD (line/signal/histogram), Stochastic (k/d), Bollinger (u/m/l/%B), ADX
  (adx/±DI), ATR — **maxErr 0.0**. (Probe discovered the library emits
  k-only/MACD-only objects during warmup — candle alignment mapped & asserted.)
- **Signal parity:** engine `crosses_above`/`crosses_below` fire counts ==
  static-array counts (8==8, 8==8) on 4000 bars.
- **Fill mechanics:** intra-bar SL at stop · gap-through SL at open · RR target
  at 2× risk · both-hit-same-bar → stop · gap-past-target at open · short-side
  SL/target · max-holding Nth bar at close · end-of-data flush.
- **Money:** flat ₹20/side ⇒ exactly ₹40/trade · %-brokerage on notional ·
  0.1% slippage adverse on both fills · per-trade gross−fees=net · Σnet ==
  summary · initial+net == final equity.
- **Gates:** maxTradesPerDay blocks same-day re-entry & resets next day ·
  capital-allocation cap skips/mallows · time square-off exit at first bar ≥ 09:17
  close, zero entries at/after cutoff.
- **Trailing stop (4 regression tests):** bar-end ratchet — entry 100/trail 12,
  bar high 151 then low 136 on the NEXT bar exits at 138 (stop 139 gapped open),
  not same-bar phantoms; no-gap fill exactly at stop; short-side mirrors;
  percent ≡ points at entry distance.
- **Warmup** returns NaN and blocks signals; **VWAP resets** per IST session.

## Notable decisions
- **Trailing-stop fill ordering** (the 1 real engine bug found by the harness):
  v1 ratcheted the stop from the current bar's high *before* checking its low,
  implying same-bar establish+trigger — invalid from OHLC. Fixed to bar-end
  ratchet; locked in with regression tests.
- Exit bar's same-bar re-entry attempt is **evaluated and gated** (mirrors the
  live worker's "flat → evaluate" loop); blocked attempts count in
  `skippedSignals`.
- Marketplace/billing remains deferred (user decision); everything else in
  §3.5 scope is implemented.

## Files touched
- `backend/src/services/engine/{indicatorEngine,ruleEvaluator,backtestEngine}.ts`
- `backend/src/services/backtestService.ts`, `backend/src/routes/backtests.ts`,
  `backend/src/routes/internal.ts`, `backend/scripts/verify-engine.mjs` (+32 regression checks)
- `supabase/functions/run-backtests/index.ts`, `supabase/CRON_SETUP.md`
- `frontend/src/lib/backtestApi.ts`, `frontend/src/pages/BacktestPage.tsx`

## Next — Step 7 (live engine), per spec §6 order with §3.7 enforced first
**`riskManager.ts` will be implemented before ANY order-placement code** (your
explicit override, ring-fenced even for paper mode). One architecture decision
awaiting your call before I build it: Supabase Edge Functions can't hold a
long-lived WebSocket, so the live worker is either **(a) a persistent Node
worker** on the same host as the backend (SmartAPI WebSocket v2, true
tick/close-bar signals, lowest latency — needs the backend host running during
market hours) or **(b) a 1-minute polling edge engine** (REST LTP snapshots via
cron — deploys cleanly on Supabase only, but coarser fills & higher API load).
I recommend **(a)**; confirm and I'll proceed with riskManager.ts → worker →
paper/live wiring.
