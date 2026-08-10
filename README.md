# Algo Trading Platform (Angel One SmartAPI + Supabase + React)

Full-stack algorithmic trading platform similar to algorooms.com: connect an
Angel One broker account, build no-code strategies, backtest them on
historical candles, and run them live in paper or real-money mode behind a
central Risk Manager.

Built module-by-module per the project spec (Section 6 build order).
Current status: **all 10 steps done ✅** — see docs/CHECKPOINT-01.md (scaffold,
schema, SmartAPI wrapper), docs/CHECKPOINT-02.md (broker-connect, end-to-end),
docs/CHECKPOINT-03.md (strategy builder + instrument infra),
docs/CHECKPOINT-04.md (backtest engine + runs UI — 35-check engine harness),
docs/CHECKPOINT-05.md (risk manager FIRST + live worker — 52-check harness),
docs/CHECKPOINT-06.md (dashboard + realtime + kill-switch UI),
docs/CHECKPOINT-07.md (risk-control UI + notification center/preferences),
docs/CHECKPOINT-08.md (vitest unit suites for rule evaluator + risk manager),
docs/CHECKPOINT-09.md (§3.1 completion: profile + onboarding wizard + password reset),
docs/ANGELONE-API-VALIDATION.md (SmartAPI docs-vs-code sweep: 11-section report, 5 fixes).
Deferred by decision: marketplace/billing (§3.10).
Cron scheduling: supabase/CRON_SETUP.md.

## Repo layout

```
algo-trading-platform/
├── frontend/                 # React 19 + Vite + TailwindCSS v4 + Zustand + Recharts
│   └── src/
│       ├── components/       # Layout shell + shared UI (kill switch, notification bell, …)
│       ├── pages/            # Dashboard, Strategies, Backtest, Watchlist, BrokerConnect, Risk, Notifications, Profile, Login/Reset
│       ├── store/            # Zustand stores (authStore live; others per module)
│       └── lib/              # supabaseClient.ts
├── backend/                  # Node 20 + Express 4 + TypeScript (CommonJS)
│   └── src/
│       ├── config/env.ts     # validated env (fails fast on missing keys)
│       ├── lib/              # crypto (AES-256-GCM), totp (otplib), rate limiters (Bottleneck), logger
│       ├── middleware/auth.ts# Supabase JWT verification on every route
│       ├── routes/           # HTTP routers (added per build step)
│       ├── services/brokers/ # BrokerAdapter interface + angelOneService (verified SmartAPI wrapper)
│       ├── supabase/         # service-role client, DB types, broker_connection store
│       └── types/            # smartapi-javascript module declarations (verified vs GitHub source)
├── supabase/
│   ├── migrations/00001_core_schema.sql   # full schema + RLS + realtime
│   └── functions/           # scheduled edge fns (token-refresh, instrument-sync, run-backtests)
└── docs/                    # checkpoint summaries per milestone
```

## Setup

```bash
npm install                 # workspaces: installs frontend + backend

# 1. Create a Supabase project, then apply the schema (SQL editor or CLI):
#      supabase link --project-ref <ref> && supabase db push
#    (supabase/migrations/00001_core_schema.sql is idempotent)
#    Auth → URL Configuration: Site URL = http://localhost:5173 and allow the
#    redirect URL http://localhost:5173/reset-password (plus production
#    equivalents). Enable the Google provider to activate the OAuth button.

# 2. Fill env vars (see .env.example):
cp .env.example backend/.env        # SUPABASE_*, BROKER_ENCRYPTION_KEY, PORT
# generate the encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
cp .env.example frontend/.env       # keep only the VITE_* lines

# 3. Regenerate DB types from your project (optional; hand-written types ship in repo):
npx supabase gen types typescript --project-id <id> > backend/src/supabase/types.ts

# 4. Run
npm run dev:backend                 # http://localhost:4000/api/health
npm run dev:frontend                # http://localhost:5173

# 5. Live engine (step 7) — SEPARATE persistent process (holds the SmartAPI
#    WebSocket; do NOT run it inside the API server in production):
npm run worker -w backend
#    Deploy as its own service on Render (same repo + env). It reconciles
#    active strategies every 5s, so activations from the UI take effect
#    automatically; status heartbeat lands in worker_heartbeats.
```

## Processes & jobs

| Process | Command | Role |
|---|---|---|
| API | `npm run dev:backend` (`node dist/index.js` prod) | auth, CRUD, backtests, risk + notification-prefs routes, `/internal/jobs/*` |
| Live worker | `npm run worker -w backend` (`node dist/worker.js` prod) | WS market feed, candle aggregation, signal evaluation, order execution, reconciliation |
| Edge fns + cron | supabase/CRON_SETUP.md | daily token refresh (08:00 IST), instrument sync (07:45 IST), backtest queue sweeper (1 min) |

## Troubleshooting

- **`does not provide an export named '…'` from `@algo/rule-schema`** — a stale
  prebuilt copy of the workspace package (`packages/rule-schema/dist` is a
  gitignored build artifact). Fix: `npm run build:schema` (or rerun
  `npm install` — the postinstall rebuilds it), then restart the dev server.
  The frontend now bundles the package **from source** via a Vite alias, so
  the frontend can't hit this anymore; the backend resolves the built dist
  through Node and the root `dev:backend` script always rebuilds it first.
- **Typecheck/vite can't find binaries** — run `npm install` at the repo root
  first (workspaces wire up `frontend`, `backend`, `packages/rule-schema`).
- **Instrument search empty / index LTP chips unresolved** — the scrip master
  hasn't synced yet: trigger it once manually (see step 6 of Setup) or wait
  for the daily cron.

## Notifications (§3.9)

All engine/risk events reach users via three channels, togglable per event type
on the Notifications → Preferences screen:

- **In-app** (always available): rows in `notifications`, pushed over Supabase
  Realtime to the header bell + notification center.
- **Telegram**: set `TELEGRAM_BOT_TOKEN` in backend env (create a bot via
  @BotFather); each user links their chat ID from the preferences screen.
  Delivery is a live Bot API `sendMessage`, best-effort.
- **Email**: set `NOTIFY_EMAIL_WEBHOOK_URL` in backend env — receives
  `POST {userId, type, title, body, at}`; point it at an edge function that
  resolves the user's email and calls your transactional provider. Until set,
  preferences are stored and the UI shows the channel as not configured.

## Testing

```bash
npm test            # vitest unit suites (68 tests): rule evaluator + risk manager
npm run verify      # integration harnesses: engine 35 checks + live/risk 52 checks
npm run typecheck   # both workspaces clean
```

The unit suites lock the two contracts spec step 10 cares about — the shared
backtest↔live signal semantics (incl. cross edges and warmup NaN handling) and
the full risk-gate decision table (incl. "exits are never blocked", live
requires configured limits, IST counter boundaries, and the §3.9 notification
side effects of a blocked order).

## Safety invariants (per spec)

- **MPIN is never persisted** — used once at login, discarded. API key + TOTP
  secret are AES-256-GCM encrypted at rest; the key lives only in backend env.
- **New strategies default to Paper mode.**
- **Every order goes through the Risk Manager** (spec 3.7 — landed EARLY at
  step 7 per safety override): `orderRouter.executeIntent` is the only path to
  a fill, and it calls `riskManager.authorizeOrder` first for paper AND live,
  entry AND exit. A repo-level structural test
  (`backend/scripts/verify-live.mjs`, section F) fails the build if any code
  ever bypasses the gate.
- **Exits are never blocked** by risk controls (they reduce risk) but still
  flow through the gate for audit + broker-connectivity checks.
- SmartAPI traffic is rate-limited (spec 2.2): ~9 orders/sec ceiling, 1/sec LTP,
  ~3/sec historical, via shared Bottleneck limiters.
- All SmartAPI method names/payloads are cross-checked against the official
  Node SDK source: https://github.com/angel-one/smartapi-javascript
