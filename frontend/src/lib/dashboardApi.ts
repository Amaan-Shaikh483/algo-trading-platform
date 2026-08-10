import { apiGet } from './api'

/* Spec §3.8 dashboard read model — mirrors backend dashboardService. */

export interface PositionRowView {
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
  runtime_state: Record<string, unknown>
  opened_at: string
  closed_at: string | null
}

export interface OrderRowView {
  id: string
  strategy_id: string | null
  broker_order_id: string | null
  symbol: string
  symbol_token: string | null
  exchange: string | null
  transaction_type: 'BUY' | 'SELL'
  order_type: string
  product_type: string | null
  quantity: number
  price: number | null
  filled_quantity: number
  average_price: number | null
  status: 'pending' | 'open' | 'complete' | 'cancelled' | 'rejected' | 'blocked' | string
  rejection_reason: string | null
  purpose: 'entry' | 'exit'
  mode: 'paper' | 'live'
  placed_at: string
  updated_at: string
}

export interface TradeLogRowView {
  id: string
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
}

export interface DashboardSummary {
  positions: { open: PositionRowView[]; closedToday: PositionRowView[] }
  realizedToday: { paper: number; live: number }
}

export interface QuoteView {
  exchange: string
  tradingsymbol: string
  symboltoken: string
  ltp: number
  open?: number
  high?: number
  low?: number
  close?: number
}

export interface BrokerBookView {
  positions: {
    tradingsymbol: string
    symboltoken: string
    exchange: string
    producttype: string
    netQuantity: number
    averagePrice: number
    lastTradedPrice: number
    pnl: number
  }[]
  holdings: {
    tradingsymbol: string
    symboltoken: string
    exchange: string
    quantity: number
    averagePrice: number
    lastTradedPrice: number
    pnl: number
  }[]
  funds: { availableCash: number; availableMargin: number; usedMargin: number } | null
  syncedAt: string
}

export interface LiveStatusView {
  online: boolean
  heartbeatAgeSec: number | null
  heartbeatAt: string | null
  state: {
    uptimeSec: number
    runtimes: { strategyId: string; name: string; mode: 'paper' | 'live'; timeframe: string; awaitingSettlement: boolean }[]
    feeds: Record<string, { status: string; tokens: number; lastTickAgeSec: number | null }>
  } | null
}

export const dashboardApi = {
  summary: () => apiGet<DashboardSummary>('/api/dashboard/summary'),
  orders: (limit = 300) => apiGet<OrderRowView[]>(`/api/dashboard/orders?limit=${limit}`),
  trades: (limit = 300) => apiGet<TradeLogRowView[]>(`/api/dashboard/trades?limit=${limit}`),
  quotes: (symbols: { exchange: string; token: string }[], mode: 'LTP' | 'OHLC' | 'FULL' = 'LTP') =>
    apiGet<QuoteView[]>(
      `/api/dashboard/quotes?mode=${mode}&symbols=${encodeURIComponent(symbols.map((s) => `${s.exchange}:${s.token}`).join(','))}`,
    ),
  brokerBook: (refresh = false) => apiGet<BrokerBookView>(`/api/dashboard/broker-book${refresh ? '?refresh=1' : ''}`),
  liveStatus: () => apiGet<LiveStatusView>('/api/live/status'),
}
