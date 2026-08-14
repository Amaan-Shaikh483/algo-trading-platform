import { apiDelete, apiGet, apiPost, apiRequest } from './api'
import type { OrderTypeConfig, RiskManagementConfig, StrategyRules } from '@algo/rule-schema'

export interface StrategyRowView {
  id: string
  user_id: string
  name: string
  description: string | null
  instrument: string
  symbol_token: string
  exchange: string
  segment: 'equity' | 'futures' | 'options'
  timeframe: string
  rules: StrategyRules
  risk_settings: unknown
  /** Order Type block mirrored from rules.orderType (null on pre-feature rows). */
  order_type: OrderTypeConfig | null
  /** Risk Management block mirrored from rules.riskManagement. */
  risk_management: RiskManagementConfig | null
  mode: 'paper' | 'live'
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface StrategyPerf {
  total_pnl: number
  today_pnl: number
  total_trades: number
  win_rate: number
  last_exit_time: string | null
}

export interface StrategyListItem extends StrategyRowView {
  perf: StrategyPerf
}

export interface StrategyPayload {
  name: string
  description?: string
  instrument: string
  symbolToken: string
  exchange: string
  segment: string
  timeframe: string
  rules: StrategyRules
  /** Optional top-level blocks (the backend folds them into `rules`). */
  orderType?: OrderTypeConfig
  riskManagement?: RiskManagementConfig
}

const apiPut = <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, body ?? {})
const apiPatch = <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, body ?? {})

export const strategyApi = {
  list: () => apiGet<StrategyListItem[]>('/api/strategies'),
  get: (id: string) => apiGet<StrategyRowView>(`/api/strategies/${id}`),
  create: (payload: StrategyPayload) => apiPost<StrategyRowView>('/api/strategies', payload),
  update: (id: string, payload: StrategyPayload) => apiPut<StrategyRowView>(`/api/strategies/${id}`, payload),
  clone: (id: string) => apiPost<StrategyRowView>(`/api/strategies/${id}/clone`),
  remove: (id: string) => apiDelete<{ ok: boolean }>(`/api/strategies/${id}`),
  toggle: (id: string, active: boolean) => apiPost<StrategyRowView>(`/api/strategies/${id}/toggle`, { active }),
  setMode: (id: string, mode: 'paper' | 'live', confirm: boolean) =>
    apiPatch<StrategyRowView>(`/api/strategies/${id}/mode`, { mode, confirm }),
}
