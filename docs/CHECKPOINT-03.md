# Checkpoint 03 — Step 5 (Strategy Builder) + instrument infra (§3.3)

Status: **complete, awaiting review.** Verified: rule-schema package builds ✅,
backend typecheck ✅, frontend build ✅ (1855 modules), scrip mapping/expiry
parser against real doc-record samples ✅, route guards smoke-tested ✅.

## What was built

### 1. `@algo/rule-schema` — the shared contract (spec §3.4 versioning)
New workspace package consumed by BOTH frontend (builder UI) and backend
(validation now; backtest + live engines next steps) — single source of truth
so live/backtest parity is structural, not a discipline.
- **Versioned schema** (`RULE_SCHEMA_VERSION = 1`): `StrategyRules { version,
  direction(long/short), entry{orderType, productType}, entryConditions(
  ConditionGroup with AND/OR combinator), exit{stopLoss(points/percent/atr),
  target(points/percent/rr_multiple), trailingStopLoss, timeSquareOff(HH:mm),
  maxHoldingBars}, risk{quantity, capitalAllocationPercent,
  maxConcurrentPositions, maxTradesPerDay} }`.
- **Indicator registry** — the full spec set: SMA, EMA, WMA, RSI, Stochastic
  (k/d), MACD (line/signal/histogram), Bollinger (upper/middle/lower/%B), ATR,
  Supertrend (value/direction), ADX (+DI/−DI), VWAP, bullish/bearish engulfing,
  doji — each with param definitions (defaults/min/max) and selectable outputs,
  plus operand types (indicator / price field OHLCV / fixed value) and operators
  (`> ≥ < ≤ crosses_above crosses_below =`).
- `validateStrategyRules` (deep, message-rich — same function gates the
  builder's Review step AND the backend on every write), `defaultRules`,
  `summarizeRules` (human-readable rule text, reused by builder, list screen,
  and later engine logs).

### 2. Instrument infra (spec §3.3 — builder dependency)
- `instrumentService.searchInstruments`: searches the **cached table only**
  (prefix-ranked, contains fallback), PostgREST-injection-safe query sanitizer.
- Scrip-master sync: downloads Angel One's official scrip JSON — **URL &
  record shape verified** against SmartAPI docs/forum (`margincalculator.
  angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json`) — filters to
  `INSTRUMENT_SYNC_EXCH_SEG` (default `NSE,BSE,NFO`), dedupes, batch-upserts
  1000/batch on `(exchange,token)` with progress logs. Expiry parser handles
  `28OCT2025` → ISO; mapper verified against the docs' real SBIN/NIFTY records.
  Ops helpers: `?maxRecords=`, `?dryRun=1`.
- `instrument-sync` edge function + cron (07:45 IST) + `POST
  /internal/jobs/instrument-sync` (cron-secret guarded).

### 3. Backend — strategies, instruments, watchlist APIs
- `POST/GET/PUT/DELETE /api/strategies`, `POST /:id/clone`, `POST /:id/toggle`,
  `PATCH /:id/mode`. Rule schema enforced on every write; edits/deletes blocked
  while active (`ACTIVE_LOCKED`); clone resets to paper+paused (spec §3.7);
  activate-live requires account risk limits configured (defense-in-depth until
  step 9's Risk Manager UI); mode switches pause the strategy; audit events on
  activate/deactivate/mode-change.
- `strategy_perf` view (migration 00002, `security_invoker`): total/today P&L,
  trade count, win rate, last exit — powers the list screen.
- `GET /api/instruments/search`, watchlist CRUD + `PATCH /:id/move` reorder.

### 4. Frontend — the real screens
- **InstrumentSearch** — debounced search-as-you-type dropdown (symbol, name,
  exchange chip, lot size), used by builder + watchlist.
- **Strategy Builder wizard (5 steps, per spec §3.4):**
  1. **Basics** — name, instrument picker, segment, timeframe (8 options),
     long/short direction, order type, product type, description.
  2. **Entry Conditions** — condition rows `[operand] [operator] [operand]`,
     operand editor (indicator with live params + output line / price field /
     fixed value), add/remove rows, Match-ALL (AND)/Match-ANY (OR) toggle.
  3. **Exit Conditions** — SL (points/%/ATR), target (RR multiple/points/%),
     trailing SL, time square-off (time picker, IST), max holding candles —
     each independently toggled.
  4. **Position Sizing & Risk** — quantity (lot-size hint), capital %, max
     concurrent positions, max trades/day + account-level-limits info panel.
  5. **Review & Save** — stat grid, human summary, **collapsible JSON
     preview** (spec transparency), client-side schema validation, save.
- **Strategies list** — search, status badges (Draft/Paper/Live), today +
  all-time P&L, trades, win rate, active toggle, Paper→Live segmented control
  opening the **spec §3.7 confirmation modal** that restates the risk settings
  and requires an explicit checkbox, Edit/Clone/Delete with confirmations,
  empty state.
- **Watchlist** — add via search, up/down reorder, remove; live LTP explicitly
  deferred to step 7's market-feed engine (noted on-page).

## Not done here (per build order)
Engine-side indicator computation (step 6/7), WebSocket watchlist prices
(step 7), risk-settings UI screen (step 9) — live activation is gated with a
clear message until then. No order-placement code was written.

## Next milestone (step 6)
Backtesting engine: chunked historical-candle fetch (SmartAPI rate limits),
bar-by-bar replay with **incremental** indicator computation
(`technicalindicators` npm), shared rule evaluator also used by live,
brokerage/slippage model, equity/drawdown curves + trade log + summary stats,
BullMQ-free async job (your Edge-Functions choice — proposal: backend worker
endpoint driven by edge-invoked queue drain), results screen with Recharts +
CSV export. **Paused here for your review.**
