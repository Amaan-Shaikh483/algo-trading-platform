# Checkpoint 05 — Step 7: Live/Paper Trading Engine (§3.6) with Risk Manager FIRST (§3.7)

Status: **complete, awaiting review.**
Architecture decision honored: **persistent Node worker** (your "a") — Edge
Functions can't hold a WebSocket. Safety override honored: **`riskManager.ts`
was written before ANY order-placement code**, and a structural source audit
now locks that invariant in the repo (fails CI if anyone bypasses the gate).

Verified: backend typecheck ✅ · live harness **52/52 ✅**
(`cd backend && npm run verify:live`) · engine harness still **35/35 ✅** ·
latent Node-20 Supabase crash found & fixed ✅ (`getServiceClient` now
constructs everywhere, polyfilled `ws`).

## What was built

### 1. Risk Manager — the gate (services/risk/riskManager.ts) — BUILT FIRST
- `evaluateGate` **pure decision core** (store-injected → unit-testable):
  sanity (qty/price/token) → broker `Connected` for live (entries AND exits,
  spec §3.7) → **exits always approved past sanity+connectivity** (blocking an
  exit increases risk — documented) → entries: kill switch → daily-block flag →
  live pre-check on unflagged breach → `RISK_NOT_CONFIGURED` (live requires
  max_daily_loss, mirrors the step-5 mode-toggle guard) → max trades/day → max
  open positions → capital-allocation limit. Account-level counters/limits are
  **live-scope** (paper risks no money; paper churn stays bounded by the
  per-strategy `maxTradesPerDay` gate in both engines).
- Counter writes are **atomic via SQL** (`record_trade_counters()` upsert,
  migration 00003): `recordAuthorizedTrade` (+1 on live placement acceptance),
  `recordClosedTrade` (realized P&L) → **daily-loss auto-pause (§3.7)**: breach
  flags the day blocked + deactivates all live strategies + notifies + audits,
  once (no double-fire); `clearDailyBlock` = the spec's manual override.
- Blocked entries → throttled `order_rejected` notification + audit rows for
  kill-switch/loss-limit blocks.

### 2. Kill switch (services/risk/killSwitchService.ts) — "Stop All & Square Off"
`executeKillSwitch`: flip flag → deactivate **all** active strategies → square
off every open position **through the gate** (live: real MARKET orders via the
router; paper: REST LTP close) → trade logs + counters + notification + audit.
`releaseKillSwitch` keeps strategies paused (user re-activates). The worker
**re-sweeps every 15s** while the switch is on, retrying stragglers.
API: `POST /api/risk/kill-switch`, plus `GET/PUT /api/risk`, `POST /api/risk/unblock`.

### 3. Order router (services/live/orderRouter.ts) — the ONLY path to a fill
Intent → ledger row (idempotent `client_ref`, unique index) → **risk gate** →
paper fill at runtime LTP (v1 model: 0 slippage/0 fees — signaled quality;
backtests remain the cost-accurate sim, documented) → live: rate-limited
`placeOrder` (MARKET/LIMIT, product, `ordertag`) → retry policy (spec §3.6:
retry once on price-freeze-style rejections or session-expired) → fill-confirm
poll (4×2s) → complete. Blocks write `status='blocked'` + reason for the
dashboard timeline.

### 4. Execution ledger (live/executionLedger.ts)
orders/positions/trade_logs writes; `client_ref` upsert-by-unique-violation
recovery (worker restart mid-bar can't double-place); per-strategy
today-entry-fill count (survives restarts for the daily gate).

### 5. Market data (live/marketFeedManager.ts + candleAggregator.ts)
- One SmartAPI **WebSocket v2 per user**, Quote-mode subscriptions (verified
  SDK source: stringly ticks, **paise → ÷100**, auto-resubscribe on reconnect,
  exponential backoff 2s→; `customError()` enabled so 401s reject catchably),
  staleness watchdog (75s silence in-session → rebuild with current session —
  tokens rotate on the daily re-login), connect retries 5s→5min.
- `CandleAggregator`: IST buckets from **09:15** (1h → 09:15,10:15,…,15:15
  tail, mirroring SmartAPI historical conventions), 1D session candle, closes
  fire on bucket-crossing ticks **or** the 1s sweep (illiquid bars + clean
  15:30), session-hours filter, stale-tick drop. Pure & heavily tested.

### 6. Strategy runtime (live/strategyRuntime.ts) — parity with backtests
- Warm-up: ~200 recent candles seed the IndicatorRuntime **inertly**; entries
  evaluate only for buckets fully **after activation** (never a stale signal);
  exits resume for open positions from `positions.runtime_state` (safety first).
- **Entries** on closed candles: same `evaluateEntrySignal` + same incremental
  runtime + same `initialStopAndTarget` (exported from backtestEngine — single
  implementation for SL %/pts/ATR, target %/pts/RR, trail) + gates
  (time-square-off, strategy maxTradesPerDay, capitalAllocation% vs broker RMS
  for live).
- **Exits at TICK level** (finer than the backtest's OHLC trigger detection —
  inherent live-vs-backtest difference, documented): SL/target/trailing market
  orders; trailing ratchets at candle close via the shared `updateTrailing`;
  time square-off + maxHolding on closes; reject→retry 60s; in-flight latch
  until the fill is confirmed or reconciliation settles it.
- `catchUp()` replays missed closes after feed reconnects (spec §3.6).

### 7. Reconciliation (live/reconciliationService.ts) — spec §3.6, 60s in-session
Broker order book vs our live pending/open orders (converges missed fills and
broker-side rejects into ledger + runtime) · broker position book vs our open
live positions (externally-closed positions booked at LTP + flagged) ·
untracked broker exposure on managed tokens → notification only (manual trades
are never auto-adopted).

### 8. Worker process (src/worker.ts, `npm run worker -w backend`)
Supervisor loops: strategy diff 5s (UI toggles/edits hot-reload; rules change →
clean runtime restart, positions resume), candle sweep 1s, kill sweeper 15s,
reconciliation 60s (09:00–16:00 IST), heartbeat 10s → `worker_heartbeats`
(read by `GET /api/live/status`, `online` when age <45s — the step-8 dashboard
widget source). No broker session → strategies stay active-but-paused with a
throttled `token_expired` notice, auto-resuming on reconnect.

### 9. Migration 00003 (+ types)
`orders.client_ref` (unique, idempotency) · `orders.purpose` entry|exit ·
`positions.runtime_state` · `worker_heartbeats` · `record_trade_counters()`.

## Honest limitations (documented, each is one focused iteration)
- Live LIMIT entries fill-poll 8s then leave to reconciliation; unfilled LIMITs
  are cancelled by the broker EOD (a "limit→market fallback" policy toggle is a
  later iteration).
- Partial fills: position opens at confirmed `filled_quantity`; broker-side
  partial-then-cancel converges via the 60s reconciliation.
- Paper LIMIT orders fill at reference LTP (treated as marketable) — noted in
  the UI copy and engine docs.
- 1D-timeframe strategies close their session candle at 15:30 sharp.

## Files
- `services/risk/{riskManager,killSwitchService}.ts` (gate FIRST, per override)
- `services/live/{liveTypes,candleAggregator,marketFeedManager,strategyRuntime,orderRouter,executionLedger,reconciliationService,liveEngineSupervisor}.ts`, `src/worker.ts`
- `routes/{risk,live}.ts` (+ registry), `services/userEvents.ts`,
  `supabase/migrations/00003_live_engine.sql`, `scripts/verify-live.mjs` (52 checks),
  `supabase/client.ts` (Node-20 realtime/WebSocket fix), README processes table.

## Next — Step 8: Dashboard (§3.8)
Live P&L widgets + positions/orders via **Supabase Realtime** (tables are
already published), strategy performance cards, broker health, market overview
strip, `/api/dashboard` read endpoints. The risk-control **UI** and
notification-center arrive in step 9 on top of today's `/api/risk` +
notifications tables (already live).
