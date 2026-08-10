# Checkpoint 08 — Step 10 (final): Formal unit tests — rule evaluator + risk manager

Status: **complete, awaiting review.** Spec §6 step 10 done → **all 10 build steps complete.**
Verified: `npm test` (vitest) **68/68 ✅** · backend typecheck ✅ · engine harness
35/35 ✅ · live harness 52/52 ✅ · frontend build ✅ (unchanged runtime).

## What was built

`vitest` wired as the formal unit layer (`npm test`; backend `vitest.config.ts`,
node env, offline dummy Supabase env as a safety net). The two `.mjs` harnesses
stay as integration smoke scripts — now also runnable via root `npm run verify`.

### `src/services/engine/ruleEvaluator.test.ts` — 19 tests
- `operandValue`: constants, price fields current-vs-previous, first-bar NaN,
  indicator outputs through a REAL `IndicatorRuntime` (SMA with genuine warmup
  → NaN → value chain, module boundary intact).
- All six comparison operators with exact boundary semantics (`gt/gte/lt/lte`
  edges, `equals` 1e-9 tolerance), verdict value passthrough, and
  non-finite-operand-never-passes for every operator.
- `crosses_above`/`crosses_below` edges locked: prev **≤** equality counts as
  crossed, current must be **strictly** past, no signal when already past on
  the previous bar, **never on the first bar** (previous = NaN) — the exact
  semantics backtest and live engines must share (§3.4/3.6 parity).
- End-to-end cross detection on a real SMA(2) runtime across 4 bars
  (no cross → cross fires → no repeat).
- Entry combinators: AND/OR truth tables + empty-group-never-signals.

### `src/services/risk/riskManager.test.ts` — 49 tests
- Gate decision table, in gate order: sanity (bad qty/price/token, incl.
  exits; precedes connectivity) → `BROKER_NOT_CONNECTED` (live entry AND
  exit; paper immune) → **exit fast-path** (kill switch / daily block / all
  limits breached / no settings → still approved; §3.7's "exits are never
  blocked") → `KILL_SWITCH` (blocks paper entries too — parity) →
  `DAILY_LOSS_LIMIT` (flagged block both modes; live pre-check boundary at
  ≤ exactly the limit) → `RISK_NOT_CONFIGURED` (live-only; paper unaffected)
  → `MAX_TRADES_PER_DAY` / `MAX_OPEN_POSITIONS` / `CAPITAL_LIMIT` boundaries
  (incl. strict-`>` capital edge: exactly-at-limit passes, ₹1 over blocks;
  counters live-scoped, paper free).
- Precedence matrix (sanity > connectivity; kill switch > not-configured;
  no-settings means no kill switch to trip).
- `riskTradingDate`: IST calendar, 18:29:59 vs 18:30:00 UTC rollover, month
  boundary.
- `authorizeOrder` with a fake `RiskStore`: fetches the 5 inputs (counter
  keyed by today's IST date), silent approvals, blocked entries fire the §3.9
  notification + `risk.order_blocked` audit, **15-min per-user+code notify
  throttle** holds, blocked exits skip notifications.

## Notable engineering notes
- **Unit seam = our own module boundary**: `userEvents` (notify/audit) is
  `vi.mock`ed and asserted as calls. Discovered the hard way: supabase-js
  retries ENOTFOUND with ~7s auth-retry backoff, so even "fail-soft" real
  plumbing against the offline dummy URL blows the 5s test timeout — mocking
  the deeper client would only move that pain inward (documented in-file).
- `tsconfig` already excluded `src/**/*.test.ts` — `dist/` stays clean
  (verified: no test artifacts compiled).
- Structural audit in `scripts/verify-live.mjs` taught to exclude `*.test.ts`
  from its file walk (unit suites legitimately reference the gate; the
  non-bypassability invariant still covers all runtime source — 52/52).

## Verification
```
npm test          # 2 files, 68 passed (ruleEvaluator 19 + riskManager 49)
npm run verify    # engine 35/35 + live 52/52 (integration regression)
```

## Project state after step 10
All §6 steps delivered: scaffold/schema → SmartAPI wrapper → broker connect →
strategy builder → backtester → risk-FIRST live worker → realtime dashboard →
risk UI + notifications → formal unit suites. Deferred per your earlier call:
marketplace/billing (§3.10); email channel needs
NOTIFY_EMAIL_WEBHOOK_URL + provider when you want delivery beyond in-app/Telegram.
