/**
 * Database types mirroring supabase/migrations/00001_core_schema.sql.
 * Hand-written for now so the repo type-checks without a live project; once
 * you create the Supabase project, regenerate with:
 *   npx supabase gen types typescript --project-id <id> > backend/src/supabase/types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

/**
 * supabase-js requires a `Relationships` member on every table type;
 * defining FK relationships is only needed for PostgREST embedding, which we
 * don't use (all joins are explicit queries) — hence [] everywhere.
 */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

// ── Row shapes ──────────────────────────────────────────────────────────────

export type ProfileRow = {
  id: string
  full_name: string | null
  phone: string | null
  timezone: string
  experience_level: 'beginner' | 'intermediate' | 'advanced'
  role: 'user' | 'admin'
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export type BrokerConnectionRow = {
  id: string
  user_id: string
  broker: string
  api_key: string
  client_code: string
  totp_secret: string
  jwt_token: string | null
  refresh_token: string | null
  feed_token: string | null
  token_expiry: string | null
  status: 'disconnected' | 'connected' | 'token_expired' | 'invalid_credentials'
  last_error: string | null
  broker_profile: Json | null
  created_at: string
  updated_at: string
}

export type InstrumentRow = {
  id: number
  token: string
  symbol: string
  name: string | null
  exchange: string
  segment: string | null
  instrumenttype: string | null
  expiry: string | null
  strike: number | null
  lotsize: number | null
  tick_size: number | null
  updated_at: string
}

export type WatchlistItemRow = {
  id: string
  user_id: string
  symbol: string
  token: string
  exchange: string
  sort_order: number
  created_at: string
}

export type StrategyRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  instrument: string
  symbol_token: string
  exchange: string
  segment: 'equity' | 'futures' | 'options'
  timeframe: string
  rules: Json
  risk_settings: Json
  /** Split long/short entry condition groups (mirrors rules.longEntryConditions). */
  long_entry_conditions: Json | null
  short_entry_conditions: Json | null
  /** Option strategy legs (mirrors rules.legs). */
  legs: Json | null
  /** Order Type block: MIS/CNC/BTST + session window + trading days (mirrors rules.orderType). */
  order_type: Json | null
  /** Risk Management block incl. profit trailing (mirrors rules.riskManagement). */
  risk_management: Json | null
  mode: 'paper' | 'live'
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

export type PositionRow = {
  id: string
  user_id: string
  strategy_id: string | null
  symbol: string
  symbol_token: string
  exchange: string
  side: 'LONG' | 'SHORT'
  quantity: number
  average_entry_price: number
  mode: 'paper' | 'live'
  status: 'open' | 'closed'
  close_reason: string | null
  runtime_state: Json
  opened_at: string
  closed_at: string | null
}

export type OrderRow = {
  id: string
  user_id: string
  strategy_id: string | null
  broker_order_id: string | null
  symbol: string
  symbol_token: string | null
  exchange: string | null
  transaction_type: 'BUY' | 'SELL'
  order_type: string
  product_type: string | null
  variety: string | null
  quantity: number
  price: number | null
  trigger_price: number | null
  filled_quantity: number
  average_price: number | null
  status: string
  rejection_reason: string | null
  client_ref: string | null
  purpose: 'entry' | 'exit'
  mode: 'paper' | 'live'
  placed_at: string
  updated_at: string
}

export type TradeLogRow = {
  id: string
  user_id: string
  strategy_id: string | null
  symbol: string
  side: 'LONG' | 'SHORT'
  quantity: number
  entry_price: number
  exit_price: number
  pnl: number
  mode: 'paper' | 'live'
  entry_time: string
  exit_time: string
  created_at: string
}

export type BacktestRunRow = {
  id: string
  user_id: string
  strategy_id: string | null
  params: Json
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  result: Json | null
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type UserRiskSettingsRow = {
  user_id: string
  max_daily_loss: number | null
  max_trades_per_day: number | null
  max_open_positions: number | null
  capital_allocation_limit: number | null
  kill_switch_active: boolean
  updated_at: string
}

export type DailyRiskCounterRow = {
  user_id: string
  trading_date: string
  realized_pnl: number
  trades_count: number
  is_blocked: boolean
  blocked_reason: string | null
  updated_at: string
}

export type WorkerHeartbeatRow = {
  worker: string
  state: Json
  updated_at: string
}

export type NotificationPreferencesRow = {
  user_id: string
  telegram_chat_id: string | null
  prefs: Json
  updated_at: string
}

export type NotificationRow = {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  channel: 'in_app' | 'email' | 'telegram'
  read: boolean
  created_at: string
}

export type AuditLogRow = {
  id: number
  user_id: string | null
  event_type: string
  event_data: Json
  created_at: string
}

export type StrategyPerfRow = {
  strategy_id: string
  user_id: string
  total_pnl: number
  today_pnl: number
  total_trades: number
  win_rate: number
  last_exit_time: string | null
}

// ── Database ────────────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>

      broker_connections: Table<
        BrokerConnectionRow,
        Partial<BrokerConnectionRow> & Pick<BrokerConnectionRow, 'user_id' | 'api_key' | 'client_code' | 'totp_secret'>
      >

      instruments: Table<InstrumentRow, Omit<InstrumentRow, 'id' | 'updated_at'> & { id?: number }>

      watchlist_items: Table<WatchlistItemRow, Omit<WatchlistItemRow, 'id' | 'created_at'> & { id?: string }>

      strategies: Table<
        StrategyRow,
        Partial<StrategyRow> &
          Pick<StrategyRow, 'user_id' | 'name' | 'instrument' | 'symbol_token' | 'exchange' | 'timeframe' | 'rules'>
      >

      positions: Table<PositionRow, Omit<PositionRow, 'id' | 'opened_at' | 'closed_at'> & { id?: string }>

      orders: Table<OrderRow, Omit<OrderRow, 'id' | 'placed_at' | 'updated_at'> & { id?: string }>

      trade_logs: Table<TradeLogRow, Omit<TradeLogRow, 'id' | 'created_at'> & { id?: string }>

      backtest_runs: Table<BacktestRunRow, Partial<BacktestRunRow> & Pick<BacktestRunRow, 'user_id' | 'params'>>

      user_risk_settings: Table<UserRiskSettingsRow, Partial<UserRiskSettingsRow> & Pick<UserRiskSettingsRow, 'user_id'>>

      daily_risk_counters: Table<DailyRiskCounterRow, Partial<DailyRiskCounterRow> & Pick<DailyRiskCounterRow, 'user_id'>>

      notification_preferences: Table<
        NotificationPreferencesRow,
        Partial<NotificationPreferencesRow> & Pick<NotificationPreferencesRow, 'user_id'>
      >

      worker_heartbeats: Table<WorkerHeartbeatRow, Partial<WorkerHeartbeatRow> & Pick<WorkerHeartbeatRow, 'worker'>>

      notifications: Table<NotificationRow, Omit<NotificationRow, 'id' | 'created_at'> & { id?: string }>

      audit_logs: Table<AuditLogRow, Omit<AuditLogRow, 'id' | 'created_at'> & { id?: number }>
    }
    Views: {
      strategy_perf: {
        Row: StrategyPerfRow
        Relationships: []
      }
    }
    Functions: {
      record_trade_counters: {
        Args: {
          p_user_id: string
          p_trading_date: string
          p_realized_delta?: number
          p_trades_delta?: number
        }
        Returns: DailyRiskCounterRow
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
