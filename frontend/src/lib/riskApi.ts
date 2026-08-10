import { apiGet, apiPost, apiRequest } from './api'

/* Spec §3.7 risk controls — mirrors backend routes/risk.ts. */

export interface RiskSettings {
  user_id: string
  max_daily_loss: number | null
  max_trades_per_day: number | null
  max_open_positions: number | null
  capital_allocation_limit: number | null
  kill_switch_active: boolean
  updated_at: string
}

export interface RiskCounter {
  user_id: string
  trading_date: string
  realized_pnl: number
  trades_count: number
  is_blocked: boolean
  blocked_reason: string | null
  updated_at: string
}

export interface KillSwitchSummary {
  strategiesDeactivated: number
  liveSquareOffs: { ok: number; failed: string[] }
  paperPositionsClosed: number
}

const apiPut = <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, body ?? {})

export const riskApi = {
  get: () => apiGet<{ settings: RiskSettings | null; today: RiskCounter | null; tradingDate: string }>('/api/risk'),
  save: (settings: {
    max_daily_loss: number | null
    max_trades_per_day: number | null
    max_open_positions: number | null
    capital_allocation_limit: number | null
  }) => apiPut<RiskSettings>('/api/risk', settings),
  killSwitch: (active: boolean) =>
    apiPost<{ killSwitchActive: boolean; summary?: KillSwitchSummary }>('/api/risk/kill-switch', { active }),
  unblock: () => apiPost<{ blocked: boolean }>('/api/risk/unblock'),
}
