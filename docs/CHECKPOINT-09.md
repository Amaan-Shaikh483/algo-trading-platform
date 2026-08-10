# Checkpoint 09 — §3.1 completion: Profile, onboarding wizard, password reset

Status: **complete, awaiting review.** (Post-step-10 module: the last
spec-mandated UI gap. Marketplace/billing §3.10 remains deferred by decision.)
Verified: frontend build + oxlint (0 warnings) ✅ · vitest 68/68 ✅ · engine
harness 35/35 ✅ · live harness 52/52 ✅ (no backend runtime changes).
**No DB migration needed** — `profiles` already carried every column
(full_name, phone, timezone, experience_level, role, onboarding_completed +
RLS own-read/own-update + signup trigger).

## What was built

### Profile page (`/profile`, §3.1 verbatim fields)
- Editable **name, phone, timezone, trading experience level**
  (beginner/intermediate/advanced as selectable cards with behavior
  descriptions). Phone format validated; direct `profiles` update under RLS,
  then `refreshProfile()` so the whole app picks it up.
- Read-only identity card: email, **role badge (user/admin)** — the field the
  deferred marketplace §3.10 will gate on — member-since, onboarding state.
- **Change password** section (`supabase.auth.updateUser`, min-length +
  confirm-match client validation).
- Honest copy: trading screens always display IST (NSE market time); the
  timezone preference is stored for account-facing features.

### First-login onboarding wizard (§3.1 "Onboarding — first-login wizard")
- Renders over any screen while `onboarding_completed = false`; per-session
  "Skip for now" snooze (sessionStorage) so it never traps a workflow.
- Live 3-item checklist: **profile basics** (inline name + experience form) →
  **broker connected** (real status from `/api/broker/status`, CTA opens
  Connect Broker) → **risk limits set** (real `max_daily_loss` state, CTA
  opens Risk Control). "Finish setup" flips the flag and the wizard is gone
  for good; skipped items stay reachable in the sidebar.

### Password recovery, completed end-to-end
- Reset email now requests an explicit `redirectTo` → `/reset-password`
  (allow that URL in Supabase dashboard → Auth → Redirect URLs — noted in README).
- `authStore` captures the `PASSWORD_RECOVERY` event into a `passwordRecovery`
  flag; the router gate force-redirects every route to the reset screen until
  the new password is set (updateUser → flag cleared → dashboard).
- `/reset-password` handles the no-session case (expired/used link) with a
  clear path back to sign-in.

### Experience level actually does something
`BeginnerHint` component driven by `profile.experience_level`: beginners see
extra guidance on the Strategy Builder ("backtest + paper first") and Risk
Control ("max daily loss = circuit breaker") pages; intermediate/advanced
users don't. (Visible today — deeper adaptive gating can build on the same
component later.)

## Files
- frontend: `pages/ProfilePage.tsx`, `pages/ResetPasswordPage.tsx` (new),
  `components/OnboardingWizard.tsx`, `components/BeginnerHint.tsx` (new),
  `store/authStore.ts` (recovery flag), `App.tsx` (route + gate),
  `pages/LoginPage.tsx` (redirectTo + doc), `components/Layout.tsx`
  (wizard mount, user card → /profile), Risk/Builder pages (hints)

## Auth setup note (Supabase dashboard)
Allow `http://localhost:5173/reset-password` (and the production equivalent)
in Authentication → URL Configuration → Redirect URLs, alongside the Site URL.
Google OAuth button works once the Google provider is enabled (unchanged).

## Remaining elective work (not spec-blocking)
- §3.10 marketplace & billing (deferred by decision — admin role field ready)
- Email notification delivery: set `NOTIFY_EMAIL_WEBHOOK_URL` (+provider)
- Deployment configs (Render API+worker, Vercel frontend, Supabase cloud)
