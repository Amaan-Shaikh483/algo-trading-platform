# Cron setup (Supabase Edge Functions + pg_cron)

Scheduled jobs are Supabase Edge Functions triggered by `pg_cron` (per the
chosen job infrastructure). Secrets are never stored in migrations — set them at
runtime:

```bash
# 1. Deploy the functions
supabase functions deploy token-refresh
supabase functions deploy instrument-sync
supabase functions deploy run-backtests

# 2. Configure secrets (CRON_SECRET must equal backend/.env CRON_SECRET)
supabase secrets set INTERNAL_API_BASE_URL=https://your-backend-host CRON_SECRET=<same-as-backend>
```

```sql
-- 3. Schedule, in the Supabase SQL editor (pg_cron + pg_net are built in).
--    08:00 IST = 02:30 UTC, daily (spec 3.2: pre-market re-login).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'token-refresh-daily',
  '30 2 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT.supabase.co/functions/v1/token-refresh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- Spec 3.3: daily scrip-master sync before market open (07:45 IST = 02:15 UTC).
select cron.schedule(
  'instrument-sync-daily',
  '15 2 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT.supabase.co/functions/v1/instrument-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- Spec 3.5: backtest queue sweeper, every minute. Runs are already kicked
-- in-process on creation — this drains runs orphaned by a crash/restart.
select cron.schedule(
  'run-backtests-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT.supabase.co/functions/v1/run-backtests',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- Inspect:    select * from cron.job;
-- Unschedule: select cron.unschedule('token-refresh-daily');
--             select cron.unschedule('instrument-sync-daily');
--             select cron.unschedule('run-backtests-every-minute');
```

All edge functions simply forward to `{INTERNAL_API_BASE_URL}/internal/jobs/*`
with the shared-secret header — the token-refresh summary
(`refreshed / markedExpired / transientFailures`), the instrument-sync summary
(`fetched / mapped / upserted / durationMs`); and the backtest sweeper summary
(`claimed / completed / failed`) are logged by the backend.
Ops helpers: `POST /internal/jobs/instrument-sync?maxRecords=500` (smoke test)
or `?dryRun=1` (validate + count without writing).
