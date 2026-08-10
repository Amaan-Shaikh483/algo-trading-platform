# Checkpoint 01 — Steps 1–3 (Scaffold → DB schema → SmartAPI wrapper)

Status: **complete, awaiting review.** Verified: backend `tsc` typecheck + build,
frontend `vite build`, crypto/TOTP/IST-format smoke tests, express boot + `/api/health`.

## What was built

### 1. Monorepo scaffold (spec §5, step 1)
- npm workspaces: `frontend` + `backend` (Node ≥20).
- **Frontend:** Vite + React 19 + TS + TailwindCSS v4 (via `@tailwindcss/vite`),
  React Router, Zustand (`authStore` w/ Supabase session listener), Recharts,
  `@supabase/supabase-js`. App shell with nav + routed placeholder pages
  (Dashboard · Strategies · Backtest · Watchlist · Broker · Login), each tagged
  with the spec section that will implement it.
- **Backend:** Express 4 + TS (CommonJS for clean interop with the CJS-only
  SmartAPI SDK), `tsx` dev runner, structured JSON logger, `/api/health`,
  central error handler, CORS locked to `FRONTEND_URL`.
- Env discipline: `.env.example` documents every var; backend refuses to boot
  with missing/invalid keys (e.g. `BROKER_ENCRYPTION_KEY` must be 64 hex chars).
- Decision recorded from your answers: **Vite SPA**, **Supabase Edge Functions +
  cron for scheduled jobs** (`supabase/functions/token-refresh`,
  `instrument-sync` stubs created), **Marketplace/billing (§3.10) deferred**.

### 2. Supabase schema (spec §4, step 2) — `supabase/migrations/00001_core_schema.sql`
- Spec's 4 tables kept verbatim-compatible, extended for modules 3.1–3.9:
  `profiles` (role user/admin, experience level, onboarding) + auto-provisioning
  trigger; `broker_connections` (+ `status` check constraint, `last_error`,
  `broker_profile`, one-per-user-per-broker unique); `instruments` (scrip cache
  w/ pg_trgm search indexes); `watchlist_items`; `strategies` (+ `symbol_token`,
  `exchange`, `segment`, `version`, `mode 'paper'` default); `positions`;
  `orders` (+ `mode`, fills, rejection reason); `trade_logs`;
  `backtest_runs` (queued/completed + progress + result jsonb);
  `user_risk_settings` + `daily_risk_counters` (daily-loss auto-pause, kill switch);
  `notification_preferences` + `notifications`; `audit_logs`.
- **RLS enabled on every table** with `user_id = auth.uid()` policies;
  `instruments` is read-only for users (cron writes via service role);
  `audit_logs` is read-only for users (backend inserts).
- Realtime publication wired for `orders`, `trade_logs`, `positions`,
  `notifications` (spec 3.8 dashboard).
- Hand-written DB types in `backend/src/supabase/types.ts` (regenerate with
  `supabase gen types` once your project exists).
- ⚠️ One deliberate spec deviation: `trade_logs` got a `user_id` column — the
  spec's own RLS policy (`user_id = auth.uid()`) is impossible without it.

### 3. Broker integration (spec §3.2 + §2, step 3) — `backend/src/services/brokers/`
- **Verified against the real SDK first** (not guessed): fetched
  `smartapi-javascript` v1.0.27 — README, `package.json`, `lib/smartapi-connect.js`,
  `lib/websocket2.0.js`, `lib/index.js`, `config/constant.js`. All wrapper calls
  match the true SDK surface. Notably confirmed: `generateSession(clientCode,
  password, totp)` (3 args), `getProfile()` (0 args), singular
  `getPosition()`/`getHolding()`, `marketData({mode:'LTP', exchangeTokens})`,
  `getCandleData` date format `"YYYY-MM-DD HH:mm"`, exports
  `SmartAPI/WebSocket/WebSocketClient/WebSocketV2/WSOrderUpdates`, WS v2
  constants (`action`, `mode`, `exchangeType` enums), LTP ticks priced in paise.
- `types.ts` — generic **BrokerAdapter** interface + normalized DTOs + typed
  `BrokerError` kinds (`session_expired | invalid_credentials | rejected |
  rate_limited | network | unknown`) + `SessionPersistence` hooks. Engine code
  will only ever see this interface (multi-broker ready, §3.2).
- `angelOneService.ts` — full method set from step 3: login (on-the-fly TOTP,
  MPIN never stored), refreshSession (`generateToken`), getProfile,
  placeOrder/modifyOrder/cancelOrder, getOrderBook/getTradeBook/getOrderDetails,
  getPositions/getHoldings/getRMS, getCandleData (IST formatting helper),
  getLTP, `createMarketFeed()` (WebSocketV2 + exponential reconnection),
  order-update feed. Includes:
  - **AG8001 session-expiry flow (§3.2):** marks connection `token_expired`,
    attempts ONE automatic re-login (shared across concurrent failures), single
    retry of the failed call, then surfaces for user notification.
  - **Rate limiting (§2.2):** Bottleneck pools — ~9/sec orders, 1/sec LTP,
    ~3/sec historical, 4/sec general; env-tunable.
  - Defensive response normalization (SmartAPI envelope quirks handled: boolean
    `status` envelope vs numeric HTTP fallback from the SDK's error interceptor).
- `brokerConnectionStore.ts` — encrypted credential save/load (AES-256-GCM,
  `v1.<iv>.<tag>.<ct>` format), session-token persistence back to
  `broker_connections`, status transitions, disconnect (tokens cleared, history
  kept) vs remove, and audit events (`broker.connected`, `token_expired`, …).
- `lib/crypto.ts` (AES-256-GCM), `lib/totp.ts` (otplib), `middleware/auth.ts`
  (Supabase JWT verified on every route — §3.1).

## Verification performed
- `npm run typecheck -w backend` ✅  · `npm run build -w backend` ✅
- `npm run build -w frontend` ✅ (79 modules, 330 KB bundle)
- AES-256-GCM encrypt→decrypt roundtrip ✅ · TOTP 6-digit ✅ · IST candle-date
  formatting ✅ · express boots, `/api/health` 200, 404 handler ✅
- Not testable here (needs your Supabase project + Angel One credentials):
  actual login/session flow — that arrives end-to-end in **step 4**.

## Deliberately NOT built yet (build order respected)
- No HTTP routes for broker-connect (step 4), no strategy/backtest/live-engine
  code (steps 5–7), **no order-placement decision paths** — `placeOrder` is an
  unexposed SDK passthrough until the Risk Manager (step 9) and unit tests
  (step 10) gate it. Paper/live parity rule will be enforced from step 7.

## Flag for later (your Edge Functions choice)
Edge Functions + cron fit scheduled jobs (token refresh 08:00 IST, instrument
sync, reconciliation). They **cannot** hold the long-lived WebSocket the live
engine (§3.6) needs — Edge invocations are short-lived. At step 7 I'll propose:
(a) one persistent Node worker process just for the market-feed engine (my
recommendation; rest stays Edge+cron), or (b) a 1-minute REST-polling engine
inside scheduled Edge Functions (simpler infra, no tick granularity).

## Next milestone (step 4)
Broker-connect flow end-to-end: `/api/broker/*` routes (save creds → encrypted
storage → test connection → status), Connect Broker UI with status badge +
TOTP help modal, `token-refresh` edge function + cron schedule, audit events.
