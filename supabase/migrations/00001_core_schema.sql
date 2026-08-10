-- ═══════════════════════════════════════════════════════════════════════════
-- 00001_core_schema.sql — Algo Trading Platform core schema (Spec Section 4)
--
-- Starts from the spec's schema verbatim and extends it for modules 3.1–3.9:
--   profiles, broker_connections (+status metadata), instruments (scrip cache),
--   watchlist_items, strategies (+versioning/exchange/token), positions,
--   orders, trade_logs (+user_id — REQUIRED for the spec's RLS policy),
--   backtest_runs, user_risk_settings + daily_risk_counters (spec 3.7),
--   notifications + notification_preferences (spec 3.9), audit_logs (spec 3.1).
--
-- Market-place/billing tables are intentionally deferred per user decision.
-- Every table has RLS enabled; per-user data uses  user_id = auth.uid().
-- Apply with:  supabase db push  (or paste into the Supabase SQL editor)
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- instrument search-as-you-type (3.3)

-- ── Shared updated_at trigger ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ════════════════════════ 3.1  Auth & profiles ════════════════════════════

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  full_name            text,
  phone                text,
  timezone             text not null default 'Asia/Kolkata',
  experience_level     text not null default 'beginner'
                       check (experience_level in ('beginner', 'intermediate', 'advanced')),
  role                 text not null default 'user'
                       check (role in ('user', 'admin')),
  onboarding_completed boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create profile skeleton on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.user_risk_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ════════════════════════ 3.2  Broker connections ═════════════════════════

create table public.broker_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  broker        text not null default 'angelone',
  api_key       text not null,        -- AES-256-GCM ciphertext (never plaintext)
  client_code   text not null,
  totp_secret   text not null,        -- AES-256-GCM ciphertext (never plaintext)
  jwt_token     text,
  refresh_token text,
  feed_token    text,
  token_expiry  timestamptz,
  status        text not null default 'disconnected'
                check (status in ('disconnected', 'connected', 'token_expired', 'invalid_credentials')),
  last_error    text,
  broker_profile jsonb,               -- snapshot of SmartAPI getProfile() once connected
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, broker)            -- one Angel One connection per user (multi-broker ready)
);
create trigger broker_connections_updated_at before update on public.broker_connections
  for each row execute function public.set_updated_at();

-- ════════════════════════ 3.3  Instruments & watchlist ════════════════════

create table public.instruments (
  id             bigint generated always as identity primary key,
  token          text not null,
  symbol         text not null,
  name           text,
  exchange       text not null,
  segment        text,
  instrumenttype text,
  expiry         date,
  strike         numeric,
  lotsize        integer,
  tick_size      numeric,
  updated_at     timestamptz not null default now(),
  unique (exchange, token)
);
create index instruments_symbol_trgm on public.instruments using gin (symbol gin_trgm_ops);
create index instruments_name_trgm   on public.instruments using gin (name gin_trgm_ops);
create index instruments_exchange_idx on public.instruments (exchange);

create table public.watchlist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  symbol     text not null,
  token      text not null,
  exchange   text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, exchange, token)
);

-- ════════════════════════ 3.4/3.6  Strategies & positions ════════════════

create table public.strategies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  description   text,
  instrument    text not null,          -- display symbol, e.g. SBIN-EQ
  symbol_token  text not null,          -- Angel One token (from instruments)
  exchange      text not null default 'NSE',
  segment       text not null default 'equity'
                check (segment in ('equity', 'futures', 'options')),
  timeframe     text not null
                check (timeframe in ('1m', '3m', '5m', '10m', '15m', '30m', '1h', '1D')),
  rules         jsonb not null,         -- versioned entry/exit condition tree
  risk_settings jsonb not null default '{}'::jsonb,
  mode          text not null default 'paper'
                check (mode in ('paper', 'live')),   -- safety default: paper
  is_active     boolean not null default false,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger strategies_updated_at before update on public.strategies
  for each row execute function public.set_updated_at();
create index strategies_user_idx on public.strategies (user_id);

create table public.positions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  strategy_id         uuid references public.strategies(id) on delete set null,
  symbol              text not null,
  symbol_token        text not null,
  exchange            text not null,
  side                text not null check (side in ('LONG', 'SHORT')),
  quantity            integer not null check (quantity > 0),
  average_entry_price numeric not null,
  mode                text not null check (mode in ('paper', 'live')),
  status              text not null default 'open' check (status in ('open', 'closed')),
  close_reason        text,
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz
);
create index positions_user_open_idx on public.positions (user_id) where status = 'open';

-- ════════════════════════ 3.5/3.6  Orders, trades, backtests ═════════════

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  strategy_id      uuid references public.strategies(id) on delete set null,
  broker_order_id  text,
  symbol           text not null,
  symbol_token     text,
  exchange         text,
  transaction_type text not null check (transaction_type in ('BUY', 'SELL')),
  order_type       text not null,       -- MARKET / LIMIT / STOPLOSS_LIMIT / STOPLOSS_MARKET
  product_type     text,                -- INTRADAY / DELIVERY / MARGIN / CARRYFORWARD / BO
  variety          text,                -- NORMAL / STOPLOSS / AMO / ROBO
  quantity         integer not null check (quantity > 0),
  price            numeric,
  trigger_price    numeric,
  filled_quantity  integer not null default 0,
  average_price    numeric,
  status           text not null default 'pending',
  rejection_reason text,
  mode             text not null check (mode in ('paper', 'live')),
  placed_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create index orders_user_placed_idx on public.orders (user_id, placed_at desc);
create index orders_broker_id_idx on public.orders (broker_order_id) where broker_order_id is not null;

create table public.trade_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid references public.strategies(id) on delete set null,
  symbol      text not null,
  side        text not null check (side in ('LONG', 'SHORT')),
  quantity    integer not null,
  entry_price numeric not null,
  exit_price  numeric not null,
  pnl         numeric not null,
  mode        text not null check (mode in ('paper', 'live')),
  entry_time  timestamptz not null,
  exit_time   timestamptz not null,
  created_at  timestamptz not null default now()
);
create index trade_logs_user_exit_idx on public.trade_logs (user_id, exit_time desc);
create index trade_logs_strategy_idx on public.trade_logs (strategy_id, exit_time desc);

create table public.backtest_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  strategy_id  uuid references public.strategies(id) on delete set null,
  params       jsonb not null,          -- date range, capital, brokerage/slippage model
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'completed', 'failed')),
  progress     integer not null default 0 check (progress between 0 and 100),
  result       jsonb,                   -- trade log, equity curve, stats
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz
);
create index backtest_runs_user_idx on public.backtest_runs (user_id, created_at desc);

-- ════════════════════════ 3.7  Risk & safety ══════════════════════════════

create table public.user_risk_settings (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  max_daily_loss           numeric,     -- ₹; null = not configured (blocks live mode per risk manager policy)
  max_trades_per_day       integer check (max_trades_per_day > 0),
  max_open_positions       integer check (max_open_positions > 0),
  capital_allocation_limit numeric,     -- ₹ max deployed capital at any time
  kill_switch_active       boolean not null default false,
  updated_at               timestamptz not null default now()
);
create trigger user_risk_settings_updated_at before update on public.user_risk_settings
  for each row execute function public.set_updated_at();

-- Auto-reset per trading day; maintained by the risk manager / engine.
create table public.daily_risk_counters (
  user_id        uuid not null references auth.users(id) on delete cascade,
  trading_date   date not null,
  realized_pnl   numeric not null default 0,
  trades_count   integer not null default 0,
  is_blocked     boolean not null default false,  -- daily-loss auto-pause (spec 3.7)
  blocked_reason text,
  updated_at     timestamptz not null default now(),
  primary key (user_id, trading_date)
);
create trigger daily_risk_counters_updated_at before update on public.daily_risk_counters
  for each row execute function public.set_updated_at();

-- ════════════════════════ 3.9  Notifications ══════════════════════════════

create table public.notification_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text,
  -- { "order_placed": {"email": true, "telegram": false, "in_app": true}, ... }
  prefs            jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,             -- order_placed | order_filled | order_rejected | sl_hit | target_hit | daily_loss_limit | strategy_error | token_expired
  title      text not null,
  body       text,
  channel    text not null default 'in_app' check (channel in ('in_app', 'email', 'telegram')),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ════════════════════════ 3.1  Audit log ══════════════════════════════════

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  event_type text not null,             -- auth.login / broker.connected / strategy.activated / ...
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

-- ════════════════════════ Row Level Security ══════════════════════════════

alter table public.profiles                 enable row level security;
alter table public.broker_connections       enable row level security;
alter table public.instruments              enable row level security;
alter table public.watchlist_items          enable row level security;
alter table public.strategies               enable row level security;
alter table public.positions                enable row level security;
alter table public.orders                   enable row level security;
alter table public.trade_logs               enable row level security;
alter table public.backtest_runs            enable row level security;
alter table public.user_risk_settings       enable row level security;
alter table public.daily_risk_counters      enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications            enable row level security;
alter table public.audit_logs               enable row level security;

-- profiles: own row only
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- broker_connections: own only (credentials never leave the user's scope; the
-- backend uses the service role and validates ownership itself)
create policy broker_conn_select_own on public.broker_connections for select using (user_id = auth.uid());
create policy broker_conn_delete_own on public.broker_connections for delete using (user_id = auth.uid());
-- (no client-side insert/update: all writes go through the backend, which encrypts)

-- instruments: global reference data — readable by any signed-in user,
-- writable only by the service role (instrument-sync cron edge function)
create policy instruments_read_all on public.instruments for select to authenticated using (true);

-- watchlist: full own CRUD
create policy watchlist_select_own on public.watchlist_items for select using (user_id = auth.uid());
create policy watchlist_insert_own on public.watchlist_items for insert with check (user_id = auth.uid());
create policy watchlist_update_own on public.watchlist_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy watchlist_delete_own on public.watchlist_items for delete using (user_id = auth.uid());

-- strategies: full own CRUD
create policy strategies_select_own on public.strategies for select using (user_id = auth.uid());
create policy strategies_insert_own on public.strategies for insert with check (user_id = auth.uid());
create policy strategies_update_own on public.strategies for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy strategies_delete_own on public.strategies for delete using (user_id = auth.uid());

-- orders / trade_logs / positions / backtests: own read + insert (status
-- mutations come from the backend engine via service role)
create policy orders_select_own on public.orders for select using (user_id = auth.uid());
create policy orders_insert_own on public.orders for insert with check (user_id = auth.uid());
create policy trades_select_own on public.trade_logs for select using (user_id = auth.uid());
create policy positions_select_own on public.positions for select using (user_id = auth.uid());
create policy backtests_select_own on public.backtest_runs for select using (user_id = auth.uid());
create policy backtests_insert_own on public.backtest_runs for insert with check (user_id = auth.uid());
create policy backtests_delete_own on public.backtest_runs for delete using (user_id = auth.uid());

-- risk settings: own read + update (users tune their own limits)
create policy risk_select_own on public.user_risk_settings for select using (user_id = auth.uid());
create policy risk_update_own on public.user_risk_settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy counters_select_own on public.daily_risk_counters for select using (user_id = auth.uid());

-- notifications: own read + read-flag update; preferences own CRUD
create policy notifications_select_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_prefs_select_own on public.notification_preferences for select using (user_id = auth.uid());
create policy notif_prefs_update_own on public.notification_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit logs: read own only; inserts happen via service role (backend)
create policy audit_select_own on public.audit_logs for select using (user_id = auth.uid());

-- ════════════════════════ Realtime (spec 3.8) ═════════════════════════════
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trade_logs') then
      alter publication supabase_realtime add table public.trade_logs;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'positions') then
      alter publication supabase_realtime add table public.positions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
