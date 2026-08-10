import { apiDelete, apiGet, apiPost } from './api'

/* Spec §3.5 — backtest queue + results. Shapes mirror backend/src/services/
   backtestService.ts (params) and engine/backtestEngine.ts (result). */

export type BacktestRunStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface BacktestParams {
  strategyId: string
  strategyName: string
  from: string
  to: string
  initialCapital: number
  brokerageType: 'flat' | 'percent'
  brokerageValue: number
  slippagePercent: number
}

export interface BacktestRunSummary {
  id: string
  user_id: string
  strategy_id: string | null
  params: BacktestParams
  status: BacktestRunStatus
  progress: number
  error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type ExitReason = 'stop_loss' | 'trailing_stop' | 'target' | 'time_squareoff' | 'max_holding' | 'end_of_data'

export interface BacktestTrade {
  side: 'LONG' | 'SHORT'
  quantity: number
  entryTime: string
  exitTime: string
  entryPrice: number
  exitPrice: number
  grossPnl: number
  fees: number
  netPnl: number
  exitReason: ExitReason
  barsHeld: number
}

export interface BacktestStats {
  initialCapital: number
  finalEquity: number
  totalNetPnl: number
  totalReturnPct: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  averageWin: number
  averageLoss: number
  profitFactor: number
  expectancy: number
  largestWin: number
  largestLoss: number
  maxDrawdown: number
  maxDrawdownPct: number
  sharpeDaily: number
  totalFees: number
  skippedSignals: number
  exposurePct: number
  candlesProcessed: number
}

export interface BacktestResult {
  summary: BacktestStats
  equityCurve: { t: string; equity: number; cash: number }[]
  drawdownCurve: { t: string; drawdown: number }[]
  trades: BacktestTrade[]
  /** Per-IST-day rows for daywise UI (absent on runs stored before this field shipped). */
  dailyRows?: BacktestDayRow[]
}

export interface BacktestDayRow {
  date: string // YYYY-MM-DD (IST)
  trades: number
  pnl: number
  equity: number
}

export interface BacktestRunDetail extends BacktestRunSummary {
  result: BacktestResult | null
}

export interface CreateBacktestInput {
  strategyId: string
  from: string // ISO
  to: string // ISO
  initialCapital: number
  brokerageType: 'flat' | 'percent'
  brokerageValue: number
  slippagePercent: number
}

export const backtestApi = {
  list: () => apiGet<BacktestRunSummary[]>('/api/backtests'),
  get: (id: string) => apiGet<BacktestRunDetail>(`/api/backtests/${id}`),
  create: (input: CreateBacktestInput) => apiPost<BacktestRunDetail>('/api/backtests', input),
  remove: (id: string) => apiDelete<{ ok: boolean }>(`/api/backtests/${id}`),
}

/** Queue/poll: a run is active while queued or running. */
export const isActiveRun = (r: Pick<BacktestRunSummary, 'status'>) => r.status === 'queued' || r.status === 'running'
