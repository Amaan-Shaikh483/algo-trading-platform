# Checkpoint 07 — Step 9: Risk-control UI + Notifications (§3.7 / §3.9)

Status: **complete, awaiting review.**
Verified: backend typecheck ✅ · frontend build + oxlint (0 warnings) ✅ ·
engine harness 35/35 ✅ · live harness 52/52 ✅ (incl. the structural
risk-gate non-bypassability audit — unchanged).

## What was built

### A. Risk Control screen (§3.7) — new `/risk` page + sidebar item
- **Account risk limits form** bound to `GET/PUT /api/risk`: max daily loss,
  max trades/day, max open positions, capital allocation limit. Empty = not
  enforced, with the honest caveat shown in the UI and repeated in the
  live-confirm modal: **without a max daily loss, LIVE mode stays off**
  (risk-manager policy since step 7); paper mode is unaffected.
- **Today panel**: trading-date, trading allowed/blocked badge, loss-consumed
  bar vs limit (with % and breach state), trades-today bar, open-positions bar
  (live count from the dashboard read model), capital-limit note.
- **Daily-loss auto-pause**: red banner with reason + confirm-modal
  **manual override** (`POST /api/risk/unblock`); notes that breaching again
  re-engages the block and that it auto-resets next trading day.
- **Kill switch panel**: explanation + the same global `KillSwitchButton`
  (still pinned in the header on every screen); active state shown platform-wide.
- **Recent risk interventions**: latest `blocked` orders (amber) with symbol,
  side, qty, mode chip, gate reason, IST time — realtime refreshed via the
  `orders` publication; deep link to the dashboard order timeline.

### B. Notifications (§3.9)
- **All trigger events now emit** (vocabulary was partially wired in steps
  6–8): added the missing **`token_expired` / re-login-failed** notifications
  — fired at the exact points automatic recovery fails (daily refresh sweep ×2,
  session-adapter "no live session", and the AG8001 → `reauthenticate`
  failure path), deduped by a per-connection 6h in-memory cooldown so a stuck
  connection can't spam. Added a **kill-switch released** notification too.
- **Event catalog + preferences** (`services/notificationDispatch.ts`):
  11 event types with labels/descriptions/critical flags; effective prefs =
  `notification_preferences.prefs` jsonb merged over defaults (in-app on,
  email/telegram off), **30s in-process cache** because `notify()` sits in hot
  order paths; cache invalidated on save. `notify()` (userEvents) is now
  prefs-aware and wraps everything best-effort (never throws into trading
  flow); backtestService's duplicate local notifier removed (one shared path).
- **Channels, honest by design**:
  - **in-app** — fully working: `notifications` row → realtime center.
  - **Telegram** — fully working when configured: `TELEGRAM_BOT_TOKEN` (env)
    + per-user chat ID → live Bot API `sendMessage` (6s timeout, fail-soft).
  - **Email** — generic webhook: POST `{userId, type, title, body, at}` to
    `NOTIFY_EMAIL_WEBHOOK_URL` (e.g. a Supabase Edge Function backed by
    Resend/SES that resolves the user's email). Until set, toggles are saved
    and the UI plainly says "not configured" — no fake "sent" claims.
- **Backend API** `/api/notifications`: `GET/PUT /preferences` (validated,
  audited, cache-invalidated; returns event catalog + channel wiring status)
  and `POST /test {channel}` → `{sent, reason?}` for wiring verification.
- **Notification center UI**:
  - Header **bell with live unread badge** (realtime publication on
    `notifications`, no polling) + dropdown (latest 6, click-to-read,
    mark-all-read, "View all").
  - `/notifications` page — **Inbox** tab: all/unread filters, per-type
    filter, 150-row feed with icons/tones per event type, relative+IST
    timestamps, realtime updates. **Preferences** tab: per-event × per-channel
    toggle matrix (critical events marked), Telegram chat-ID linking, channel
    wiring status badges, **Send-test** buttons with honest results.

### C. Live-confirm modal upgrade (§3.7 verbatim requirement)
"Switch to LIVE" on the Strategies page now **restates the actual account
risk settings in effect**: max daily loss (+ today used), trades/day (+ used),
open positions, capital limit, kill-switch/daily-block states — plus a
blocking-style warning + link to `/risk` when max daily loss is unset.

## Files
- backend: `services/notificationDispatch.ts` (new), `routes/notifications.ts`
  (new, mounted at `/api/notifications`), `services/userEvents.ts`
  (prefs-aware notify), `services/backtestService.ts` (shared notifier),
  `services/brokerConnectionService.ts` (token_expired notifies),
  `supabase/brokerConnectionStore.ts` (`getConnectionMeta`),
  `services/risk/killSwitchService.ts` (release notify),
  `brokers/angelOneService.ts` (comment), `config/env.ts` + `.env.example`
  (2 optional channel vars)
- frontend: `pages/RiskPage.tsx`, `pages/NotificationsPage.tsx`,
  `components/NotificationBell.tsx`, `components/NotificationIcon.tsx`,
  `lib/notificationApi.ts`, `lib/notificationMeta.ts`, `lib/format.ts`
  (`relTime`), `lib/realtime.ts` (unique channel topics — multiple widgets
  now subscribe concurrently), `components/ui.tsx` (`Switch`), Layout
  (bell + Risk nav), App routes, StrategiesPage (live-confirm risk summary)

## Known limits (honest notes)
- Email delivery needs operator config (webhook + provider); the platform
  stores prefs and dispatches the moment the env exists.
- `daily_risk_counters` isn't in the realtime publication, so the Today's-usage
  bars refresh on order/position activity and after your own actions (not
  tick-by-tick) — intentional to avoid counter-write chatter.
- In-app is the channel of record; email/telegram failures only warn-log
  (notifications must never break trading flow).

## Next — Step 10 (final): formal `vitest` unit suites
Rule evaluator (operator edges incl. crosses/warmup NaN semantics) and the
risk-manager gate decision matrix as committed test files (`npm test` =
`vitest run`); the two `.mjs` harnesses stay as integration smoke scripts.
Then final README wrap-up.
