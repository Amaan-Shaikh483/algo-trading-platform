-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 00003 — Step 7: live/paper trading engine + §3.7 risk controls
--
--   - orders.client_ref    : idempotency key (worker restarts can't double-fire)
--   - orders.purpose       : 'entry' | 'exit' — the risk manager treats exits
--                            differently (never blocked; exits REDUCE risk)
--   - positions.runtime_state : engine mirror (SL/target/trail levels, bars
--                            held, last evaluated candle) so a worker restart
--                            resumes exits without recomputing from scratch
--   - worker_heartbeats    : singleton rows per worker process; step-8
--                            dashboard shows "engine online" from here
--   - record_trade_counters(): ATOMIC per-day risk counter upsert used by the
--                            risk manager (concurrent workers can't lose a P&L
--                            delta or a trade increment)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── orders: idempotency + purpose ───────────────────────────────────────────
alter table public.orders
  add column if not exists client_ref text,
  add column if not exists purpose text not null default 'entry'
    check (purpose in ('entry', 'exit'));

create unique index if not exists orders_client_ref_key
  on public.orders (client_ref) where client_ref is not null;

comment on column public.orders.client_ref is
  'Engine-generated idempotency key: {strategyId}:{purpose}:{candleBucketEpoch}';

-- ── positions: engine runtime mirror ────────────────────────────────────────
alter table public.positions
  add column if not exists runtime_state jsonb not null default '{}'::jsonb;

comment on column public.positions.runtime_state is
  'Live-engine mirror: {stopLoss, stopLossSource, target, trailDistance, peakPrice, barsHeld, lastCandleTime, entryFee, trailing}';

-- ── worker heartbeats (engine-online signal for the dashboard) ──────────────
create table public.worker_heartbeats (
  worker     text primary key,          -- e.g. 'live-engine'
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.worker_heartbeats enable row level security;
-- any signed-in user may read engine status; only the service role writes
create policy worker_heartbeats_read on public.worker_heartbeats
  for select to authenticated using (true);

-- ── atomic risk counters ────────────────────────────────────────────────────
-- Upsert with a row-level lock so concurrent exit fills / entry authorizations
-- never lose an increment. Returns the updated row so the caller can evaluate
-- the daily-loss breach decision against the POST-update value.
create or replace function public.record_trade_counters(
  p_user_id       uuid,
  p_trading_date  date,
  p_realized_delta numeric default 0,
  p_trades_delta   integer default 0
) returns public.daily_risk_counters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_risk_counters;
begin
  insert into public.daily_risk_counters (user_id, trading_date, realized_pnl, trades_count)
  values (p_user_id, p_trading_date, p_realized_delta, p_trades_delta)
  on conflict (user_id, trading_date)
  do update set
    realized_pnl = daily_risk_counters.realized_pnl + p_realized_delta,
    trades_count = daily_risk_counters.trades_count + p_trades_delta
  returning * into v_row;
  return v_row;
end $$;

-- Only the service role (backend worker) mutates counters.
revoke all on function public.record_trade_counters(uuid, date, numeric, integer) from public;
grant execute on function public.record_trade_counters(uuid, date, numeric, integer) to service_role;

-- Engine-status pushes for the step-8 dashboard (same pattern as 00001 for
-- orders/trade_logs/positions/notifications).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'worker_heartbeats'
  ) then
    alter publication supabase_realtime add table public.worker_heartbeats;
  end if;
end $$;
