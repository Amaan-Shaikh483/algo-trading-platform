# Checkpoint 02 — Step 4 (Broker-connect flow end-to-end)

Status: **complete, awaiting review.** UI follows the approved AlgoRooms-style
reference (light theme, left sidebar, white cards, blue primary, status badges).
Verified: backend typecheck + build ✅, frontend build ✅, auth/cron guard smoke
tests ✅. (Live Angel One login can't be exercised here — needs real credentials.)

## What was built

### Backend — `/api/broker/*` (spec §3.2, all behind Supabase-JWT middleware)
| Route | Behavior |
|---|---|
| `POST /api/broker/test` | Attempts SmartAPI login with entered credentials, returns broker profile. **Saves nothing** — powers the "Test Connection" button. |
| `POST /api/broker/connect` | Encrypts + stores credentials (AES-256-GCM), logs in, persists session tokens, snapshots broker profile, audits `broker.connected`. On failure: status → `invalid_credentials` (credential problems) or `disconnected` (transient), audits `broker.connect_failed`. |
| `GET /api/broker/status` | Badge state + broker profile + token expiry + last error. **Never returns secrets.** |
| `POST /api/broker/reconnect` | MPIN-only re-login (stored creds reused) — the "Token Expired" review CTA path. |
| `POST /api/broker/disconnect` | Clears tokens, keeps credentials + all history (per spec). |
| `DELETE /api/broker` | Full removal incl. encrypted credentials (orders/strategies untouched). |
| `POST /internal/jobs/token-refresh` | Spec §3.2 daily re-login for every connection via stored refresh token (MPIN-free, since MPIN is never stored). Marks stale connections `token_expired` + audits `broker.token_refreshed`/`broker.token_expired`. Guarded by `x-cron-secret`. |

- New `services/brokerConnectionService.ts` orchestration layer over the
  Checkpoint-01 adapter/store; adapter now supports session restoration with an
  externally bound API key (`useSession(session, apiKey)`).
- Central error mapper: `BrokerError` kinds → HTTP (`INVALID_CREDENTIALS`,
  `SESSION_EXPIRED`, `BROKER_UNREACHABLE`, `RATE_LIMITED`); no stack leaks.
- Smoke-tested: unauthenticated `/api/broker/*` → 401, internal endpoint
  rejects missing/wrong cron secret → 401.

### Token-refresh cron (Supabase Edge Functions — your chosen infra)
- `supabase/functions/token-refresh/index.ts` fully implemented: forwards to the
  backend internal endpoint with the shared secret (Node SDK stays backend-side).
- `supabase/CRON_SETUP.md`: deploy + secrets + `pg_cron` SQL (**08:00 IST** =
  02:30 UTC daily). One-round-trip design, no secrets in migrations.

### Frontend — full app shell per your reference screenshots
- **New visual language:** white sidebar (logo, icon nav, user card at bottom
  with broker-status dot + client code + sign-out), light `#f4f6fb` content,
  rounded white cards, brand-blue buttons, Inter/Poppins. Lucide icons.
- **Real auth (§3.1 — required for end-to-end):** Sign in / Sign up tabs
  (email+password via Supabase; profile auto-provisioned by the schema trigger),
  email-confirmation + forgot-password flows, Google OAuth button (activates
  once enabled in Supabase dashboard), protected routes via `Protected` gate.
  *Deferred to a later UI polish pass: onboarding wizard, reset-password page, role-based admin UI.*
- **Connect Broker page (spec §3.2 verbatim):**
  - Form: API Key, Client Code, MPIN (never stored), TOTP Secret — both with
    show/hide toggles — plus "How to get this?" modal (Angel One External-TOTP
    steps + docs link).
  - **Test Connection** → inline success (shows broker-side name/client code)
    /failure alert before anything is saved.
  - Status badge per spec: `Connected` green · `Token Expired` yellow ·
    `Disconnected` red · `Invalid Credentials` red with retry CTA (form returns
    prefilled with client code).
  - Connected card: broker-side name, session-valid-until, exchange/product
    chips, Disconnect vs Remove Connection (with confirm modal explaining the
    data-retention difference), security note.
  - Token Expired card: MPIN-only reconnect form (fresh daily session).
- Dashboard now shows the "Connect to your broker" blue gradient CTA banner
  (reference screenshot 1) until the broker is connected.

## To run it end-to-end (your environment)
1. Apply `supabase/migrations/00001_core_schema.sql` to your Supabase project
   (SQL editor or `supabase db push`).
2. `backend/.env` ← SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
   BROKER_ENCRYPTION_KEY, CRON_SECRET; `frontend/.env` ← VITE_* (see .env.example).
3. `npm install && npm run dev:backend` + `npm run dev:frontend`.
4. Sign up → Connect Broker → (tests against your real Angel One SmartAPI app).
5. Optional: deploy `token-refresh` function + cron per `supabase/CRON_SETUP.md`.

## Notes / decisions
- Spec's status-badge colors followed literally (Disconnected = red).
- MPIN-less reconnect uses SmartAPI `generateToken` (refresh token) — that is
  what makes the daily cron possible without storing MPINs.
- Edge function is a thin forwarder by design: the official SmartAPI SDK is
  Node/CommonJS; keeping all SmartAPI calls backend-side avoids maintaining a
  parallel Deno REST implementation.

## Next milestone (step 5)
Strategy Builder UI + versioned JSON rule schema (spec §3.4), instrument
search (§3.3 scrip cache + `instrument-sync` cron) since the builder's
instrument picker depends on it, strategy CRUD routes, list screen with
status/toggle, clone. **Paused here for your review.**
