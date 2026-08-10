# Checkpoint 06 — Step 8: Dashboard (§3.8)

Status: **complete, awaiting review.**
Verified: backend typecheck ✅ · frontend build ✅ · engine harness 35/35 ✅ ·
live harness 52/52 ✅ (unchanged, regression-guarded).

## What was built

### Backend — `/api/dashboard` read model (routes/dashboard.ts + dashboardService.ts)
- `GET /summary` — engine positions (open + closed-today, IST day) + today's
  realized P&L split paper/live.
- `GET /orders` / `GET /trades` — recent timelines (limit-bounded).
- `GET /quotes?symbols=NSE:3045,...&mode=LTP|OHLC|FULL` — quote snapshots via
  the user's session; **5s in-process cache** per token set so widgets can't
  stampede the §2.2 rate limits. Adapter `getLTP` extended with quote modes
  (SDK example shape `marketData({mode:"FULL", exchangeTokens})` re-verified
  from the installed SDK).
- `GET /broker-book[?refresh=1]` — broker positions + holdings + funds (RMS),
  **20s cache** with force-refresh for the manual "Refresh" button + the
  engine's 60s reconciliation keeps order/fill states converged in between.

### Frontend — the dashboard (spec §3.8, point by point)
- **Live P&L widget:** realized today (paper/live split), unrealized on open
  positions (15s quote snapshots; `*` marks partially-priced), day total,
  all-time realized — plus **per-strategy split** in the strategy cards.
- **Positions & holdings:** "Engine positions" tab (symbol, side, qty, entry,
  live LTP, unrealized, current SL/target from `runtime_state`, mode chip) and
  a "Broker book" tab (positions + holdings + funds with manual Refresh +
  synced-at stamp).
- **Merged order/trade timeline:** Orders tab merges our execution log with
  broker-side state (status badges pending/open/complete/cancelled/rejected +
  **`blocked` in amber for risk-gate interventions**, broker order id /
  rejection reason column, fill ratio) and a Trade-log tab for realized P&L —
  both filterable by symbol / mode / status / strategy, sticky-header scrolling.
- **Strategy performance cards:** today P&L, all-time P&L, win rate, Live /
  Paper / Paused badge, and a **quick pause/resume** with an honest confirm
  modal (explains the 5s worker reconcile, "no stale-candle entries", and that
  pausing keeps the position's SL/target levels saved rather than squaring off).
- **Broker connection health** chip (from §3.2 status) + connect-broker hero
  when not connected — always visible in the header row.
- **Market overview strip:** NIFTY 50 / NIFTY BANK / SENSEX chips with LTP +
  intraday change% (FULL-quote mode). Tokens are **resolved from the cached
  instruments table** (search, preferred-exchange match) — zero hardcoded
  tokens; chips degrade gracefully while unresolved.
- **Engine online badge:** reads the `worker_heartbeats` row — now also in the
  realtime publication (migration 00003 addendum), so the badge flips live;
  tooltip shows uptime + runtime count, tick-age suffix.
- **Realtime, not polling (spec line honored):** `useRealtimeTables` subscribes
  `orders` / `trade_logs` / `positions` postgres_changes (RLS-filtered,
  debounced 300ms) and refreshes the read models; quotes/status use only
  low-frequency snapshots as designed above.

### Kill switch, everywhere (§3.7)
`KillSwitchButton` pinned in the **global Layout header** → reachable from any
screen ("emergency-accessible"): red armed state / KILL ACTIVE state, explicit
consequence modal, activates/deactivates via `POST /api/risk/kill-switch`,
post-mortem summary (strategies stopped, positions squared off, failures the
worker keeps retrying), release keeps strategies paused (documented in-modal).
Also new shared `lib/riskApi.ts` + `lib/format.ts` (INR/IST helpers).

## Files
- backend: `routes/dashboard.ts`, `services/dashboardService.ts`, router mount,
  `getLTP` mode param (+ interface), migration-00003 realtime addendum
- frontend: `pages/DashboardPage.tsx` (full build), `components/KillSwitchButton.tsx`,
  Layout header, `lib/{dashboardApi,riskApi,realtime,format}.ts`

## Next — Step 9: Risk-control UI + notifications (§3.7/§3.9)
Risk settings form screen (max daily loss, trades/day, open positions, capital
limit — the API exists), notification center screen reading the `notifications`
table (realtime), per-event channel preferences UI, and the live-confirm modal
already in place gets wired to the risk summary shown there. Then step 10:
formal unit tests (vitest) for the rule evaluator + risk manager.
