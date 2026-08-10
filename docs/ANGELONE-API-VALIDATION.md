# Validation Report — Angel One SmartAPI Implementation

**Date:** 2026-08-06 · **Prompt:** `uploads/angel-one-api-validation-prompt.md` (11-section checklist)
**Validated against:**
- Official docs read live on 2026-08-06: Introduction (Login Flow / Generate Token / Profile / Funds / Logout), Orders (constants + place/modify/cancel payloads), Response Structure, Error Codes (30 codes), Rate Limit (26-API table), Market Data, Historical, WebSocket 2.0, Portfolio, GTT, Instruments, CAS
- Installed SDK source `smartapi-javascript@1.0.27` (`lib/smartapi-connect.js`, `lib/websocket2.0.js`) — every wrapper call was traced to the SDK function it invokes
- Implementation: `backend/src/services/brokers/angelOneService.ts`, `brokers/types.ts`, `lib/rateLimiter.ts`, `services/live/orderRouter.ts`, `live/marketFeedManager.ts`, `instrumentService.ts`, `brokerConnectionService.ts`

**Verdict: 9/11 sections fully compliant · 2 sections partially compliant by deliberate scope (GTT, position conversion) · 5 issues found → all 5 fixed in this sweep.**

---

## ✅ Section 1 — Authentication & Session Management: PASS

| Checklist item | Status | Evidence |
|---|---|---|
| `login()` → `generateSession()` payload per docs | ✅ | Docs Login Request `{clientcode, password, totp}`; adapter calls SDK `generateSession(clientCode, mpin, totp)` — traced through SDK `user_login` route |
| MPIN handling | ✅ | Current docs take the PIN as `password` over TLS (no AES step); MPIN is used **only** during login and is **never persisted** (spec §3.1) |
| TOTP dynamic | ✅ | `otplib.authenticator.generate(base32Secret)` on the fly from the encrypted-at-rest (AES-256-GCM) secret |
| jwt/refresh/feed tokens captured | ✅ | Both `feedtoken` (SDK's actual key) and `feedToken` casings read; all three persisted via `persistSession` |
| Token expiry tracked + refreshed | ✅ | Docs: session lives till midnight; `token_expiry` column + daily **08:00 IST** `generateToken` refresh cron (`CRON_SETUP.md`) |
| `logout()` on disconnect | ✅ | Called on Disconnect/Remove (docs themselves recommend daily logout) |
| All token error codes handled | ✅ **fixed** | `unwrap()` previously matched only `AG8001`; now the full docs token family `{AG8001 Invalid Token, AG8002 Token Expired, AG8003 Token missing}` triggers the same recovery: mark `token_expired` → one-shot re-login via stored refresh token (`AB8050/51` covered in the refresh branch) → single retry → `token_expired` notification (6h cooldown) |

## ✅ Section 2 — Orders: PASS (3 fixes applied)

- **Payload** matches the docs Place Order example field-for-field: `variety, tradingsymbol, symboltoken, transactiontype, exchange, ordertype, producttype, duration, price, triggerprice, quantity, squareoff, stoploss, ordertag`. (Docs show string values; JSON numbers are coerced server-side — the SDK passes payloads through untouched. Informational only.)
- **Constants** match the docs Order Constants table exactly — `ordertype: MARKET/LIMIT/STOPLOSS_LIMIT/STOPLOSS_MARKET`, `producttype: DELIVERY/CARRYFORWARD/MARGIN/INTRADAY/BO`, `duration: DAY/IOC`, exchanges `NSE/BSE/NFO/MCX/BFO`.
- ❌→✅ **`AMO` variety removed** (`types.ts:38`): the docs variety enum is `NORMAL/STOPLOSS/ROBO`; `AMO` is Kite vocabulary that SmartAPI would reject (AB1008). Was unreferenced.
- **Token format note:** the checklist's `"4.1!NSE_EQ|22"` expectation is the **legacy** feed format. Current SmartAPI order/market-data APIs take plain scrip-master tokens (`"3045"`) — we emit those correctly via the `instruments` table mapping.
- **Modify only pending orders:** the live engine never calls `modifyOrder` (cancel-and-replace avoids the pending-state race); the adapter method is a thin pass-through with the contract documented.
- **Books/status:** `getOrderBook`/`getTradeBook` have no pagination in SmartAPI (full-day arrays) ✅; statuses normalized (`complete/cancelled/rejected/open/trigger pending→open/pending`) ✅; rejection `text` preserved as `rejectionReason` ✅.
- **Retry policy (docs §Exceptions):** price-freeze/circuit/band rejections retried once; session-expired → re-auth once → single retry; idempotent `client_ref` ledger rows mean engine restarts can never double-place (regression-covered by `verify-live.mjs`).
- ❌→✅ **Rate limits now match the 26-row docs table exactly** (`rateLimiter.ts` rewritten):
  - Orders: docs say **9/sec cumulative across place+modify+cancel** (500/min, 1000/hr) — limiter was 110ms (9.09/s, marginally over) → now 115ms (≤8.7/s) **plus a 500/min reservoir bucket** chained ahead; the hourly cap is structurally unreachable (risk manager's daily trade caps fire first).
  - `getOrderBook/getTradeBook/getPosition/getHolding-getAllHolding`: docs **1/sec** each — these shared a 4/sec `generalLimiter` ❌ → now a dedicated 1/sec `portfolioLimiter` (RMS, capped 2/sec by docs, shares it conservatively).
  - `getProfile`: docs **3/sec** → `generalLimiter` tightened to ≤3/sec.
- ❌→✅ **AB4008 (`ordertag` must be < 20 chars):** `orderRouter` sliced to 20 → now 19.

## ✅ Section 3 — Positions & Holdings: PASS (1 deliberate gap)

- `getPositions()` → SDK `getPosition()` (day positions; `netqty` signed, `avgnetprice`, `ltp`, `pnl`) ✅; `getHoldings()` → `getAllHolding()` with the docs envelope `data.holdings[]` handled ✅. M2M/`pnl` taken from the broker payload (source of truth) ✅; closed rows (`netqty 0`) filtered by the runtime ✅.
- ⏸️ **`convertPosition` not implemented — by scope.** The engine only trades INTRADAY products that square off same-day, so INTRADAY→DELIVERY conversion is unreachable. SDK method exists if a delivery strategy is ever added.

## ✅ Section 4 — Funds & Margin: PASS (1 design note)

- `getRMS()` maps **Angel's actual** fields (`availablecash|net`, `availableintradaypayin|availablelimitmargin`, `utiliseddebits`) — the sample JSON in the validation prompt (`available`, `collateralmargin`) is Zerodha-Kite's shape, not Angel's; ours follows Angel's docs/SDK.
- ℹ️ **Pre-order margin check:** the Risk Manager gates on user-configured capital/order-value/daily-loss limits; a live RMS fetch before every order is deliberately *not* done (broker rejection is the final line, and it surfaces as an `order_rejected` notification). Documented enhancement: optional RMS probe in `authorizeOrder` for margin-product strategies later.

## ✅ Section 5 — Market Data & Quotes: PASS (1 fix)

- Request `{mode: 'LTP'|'OHLC'|'FULL', exchangeTokens}` and response `data.fetched[]` match the docs exactly (both `tradingSymbol/symbolToken` casings mapped) ✅.
- ❌→✅ **50 tokens/request cap** (docs, Live Market Data API): `getLTP` now splits via new pure helper `splitExchangeTokens` and merges `fetched` — previously `dashboardService` silently *dropped* tokens beyond 50 (only reachable with >50 open positions, but non-compliant).
- Rate: `marketDataLimiter` stays at **1 req/sec**. The docs are self-inconsistent here (MarketData page: *"1 request per second"*; Rate Limit table quote row: *10/sec*) — 1/sec complies with both.

## ✅ Section 6 — Historical Data: PASS (1 fix)

- All 8 docs intervals supported (`ONE_MINUTE…ONE_DAY`) ✅; dates formatted `"YYYY-MM-DD HH:mm"` **IST** ✅ (unit-tested incl. midnight rollover); `symboltoken` used ✅; multi-day ranges chunked per docs max-days using conservative N−1 margins (1m:29d, 3m:59d, 5m/10m:99d, 15m/30m:199d, 1h:399d, 1D:1999d) and stitched ascending ✅.
- ❌→✅ **Docs windows now enforced:** historical is 3/sec **and 150/min and 5000/hr** — added chained minute/hour Bottleneck reservoirs so large backtests queue instead of tripping `403 Access Denied`.

## ✅ Section 7 — WebSocket Streaming 2.0: PASS

- Official SDK `WebSocketV2` (headers `x-client-code / Authorization / x-api-key / x-feed-token` per docs) ✅; feed token rotates with the daily 08:00 IST refresh and the watchdog rebuilds feeds on the fresh session ✅; ≤3 concurrent connections per client code (docs) — we run 1 market feed/user ✅.
- Subscription frame `{action:1|0, mode:1|2|3, exchangeType, tokens[]}` matches docs constants (`nse_cm=1…mcx_fo=5`); one mode per token as docs recommend (mode 2 QUOTE: LTP + traded qty + day OHLC/volume) ✅.
- Resilience: SDK-native exponential reconnect + auto-resubscribe (`subscribeData` replay — verified in `websocket2.0.js`), plus manager-level connect backoff 5s→5min, 75s staleness watchdog, catch-up via historical gap-fill on reconnect ✅. Ticks: binary-parser strings, paise÷100 ✅ (docs response structure).

## ⏸️ Section 8 — GTT: NOT IMPLEMENTED (declared scope, not a defect)

- Exits (SL/target/time) are engine-managed intra-session by the live worker; GTT rules are only needed for overnight/delivery carry — out of v1 scope. SDK `createRule/modifyRule/cancelRule/ruleList/ruleDetails` are available if a positional product is added.

## ✅ Section 9 — Scrip Master / Instruments: PASS (2 notes)

- Daily sync from the official URL (`OpenAPIScripMaster.json`) → `instruments` table with trigram search ✅; exchanges `NSE,BSE,NFO` default, env-tunable ✅; `lotsize`/`tick_size` persisted ✅.
- ℹ️ Recommended hardening (not applied — changes risk behavior): enforce lot-multiple quantity validation in the Risk Manager for F&O strategies.
- ℹ️ **CAS (live since 03 Aug 2026):** scrip master now ships `is_cas_enabled`; SmartAPI rejects order entry 3:15–3:20pm and SL orders 3:15–3:40pm for CAS scrips. Our strategies' time square-offs fire before 15:15 by default, so v1 is unaffected; captured here for awareness — consider persisting the field later.

## ✅ Section 10 — Error Handling & Rate Limiting: PASS

- Full 30-code Error Codes table reviewed ✓; token codes → re-login path (Section 1); business rejections (`AB10xx` etc.) → `BrokerError 'rejected'` + `order_rejected` notification; HTTP `429` → `kind: 'rate_limited'`; HTTP failures (numeric `status` from the SDK interceptor) → `network` ✅.
- Circuit breakers everywhere the docs imply them: one-shot re-auth (no infinite loops), max **1** placement retry, fill-poll 4×2s then the 60s reconciliation loop converges, feed staleness rebuild, consecutive-failure strategy pause + kill-switch ✅.
- Rate limiting per the docs table — see Section 2 fixes; all limits env-tunable without code changes.

## ✅ Section 11 — Code Quality & Safety: PASS

- AES-256-GCM encryption at rest (`BROKER_ENCRYPTION_KEY`); MPIN never stored; TOTP secret encrypted; logs carry ids/messages only, never secrets ✅; every API call funnels through `try/catch → unwrap → BrokerError(kind, code, raw)` ✅; strict TypeScript ✅; retries bounded everywhere ✅.
- Test floor after this sweep: **77/77 vitest** (incl. new `brokers/angelOneService.test.ts` — session codes, 50-token chunking, IST date formatting) · **verify-engine 35/35** · **verify-live 52/52** · typecheck both workspaces · oxlint 0 warnings.

---

## Fix ledger (all applied 2026-08-06)

| # | Severity | Location | Fix |
|---|---|---|---|
| 1 | High (reliability) | `angelOneService.ts` `unwrap()` | `AG8002`/`AG8003` now join `AG8001` in the session-recovery path |
| 2 | High (compliance) | `rateLimiter.ts` + call sites | Per-API limiter topology matching the docs table: dedicated 1/s `portfolioLimiter`; `generalLimiter` ≤3/s; orders ≤8.7/s + 500/min reservoir; historical +150/min +5000/hr reservoirs |
| 3 | Medium | `angelOneService.ts` `getLTP` | 50-token/request chunking + merge (`splitExchangeTokens`) |
| 4 | Medium | `orderRouter.ts` | `ordertag` ≤19 chars (AB4008) |
| 5 | Low | `types.ts` | Removed undocumented `AMO` variety |

**Deferred (declared, not defects):** GTT rules · `convertPosition` · EDIS/TPIN (no delivery selling) · option Greeks / gainers-losers / PCR endpoints · RMS probe in the risk gate · lot-multiple validation · CAS `is_cas_enabled` persistence.
