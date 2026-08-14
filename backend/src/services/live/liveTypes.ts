import type { Exchange } from '../brokers/types'

/**
 * Shared live-engine vocabulary (spec §3.6).
 */

/** Normalized tick fanned out to aggregators / strategy runtimes (prices already ÷100 from paise). */
export interface LiveTick {
  symbolToken: string
  exchangeType: number
  price: number
  /** Last traded quantity when the feed mode supplies it (Quote mode); 0 otherwise. */
  qty: number
  /** Exchange timestamp in epoch ms (falls back to local receive time). */
  ts: number
}

/** SmartAPI WebSocket v2 exchange-type constants (verified: config/constant.js). */
export const WS_EXCHANGE_TYPE: Record<Exchange, number> = {
  NSE: 1, // nse_cm
  NFO: 2, // nse_fo
  BSE: 3, // bse_cm
  BFO: 4, // bse_fo
  MCX: 5, // mcx_fo
  CDS: 13, // cde_fo
}

/** Feed subscription mode constants (verified: config/constant.js). */
export const WS_SUBSCRIPTION_MODE = { LTP: 1, Quote: 2, SnapQuote: 3, Depth: 4 } as const

/** Exit reasons shared with the backtest engine's vocabulary (parity matters for dashboards/tests). */
export type LiveExitReason =
  | 'stop_loss'
  | 'trailing_stop'
  | 'target'
  | 'time_squareoff'
  | 'max_holding'
  | 'kill_switch'
  | 'reconciled_external'
  | 'strategy_stopped'
  /** Risk Management: overall Exit Profit (INR) reached. */
  | 'overall_profit'
  /** Risk Management: overall Exit Loss (INR) reached. */
  | 'overall_loss'
  /** Risk Management: profit fell back to the trailing locked floor. */
  | 'profit_trailing'

/** Engine mirror persisted on positions.runtime_state — worker restarts resume exits from here. */
export interface PositionRuntimeState {
  stopLoss?: number
  stopLossSource?: 'base' | 'trail'
  target?: number
  trailDistance?: number
  /** Best favorable price since entry (trailing). */
  peakPrice?: number
  barsHeld: number
  /** ISO of the last CLOSED candle the exit levels were ratcheted with. */
  lastCandleTime?: string
  entryTime: string
}

export interface StrategyRuntimeDeps {
  executeIntent: (intent: import('./orderRouter').RouterIntent) => Promise<import('./orderRouter').RouterOutcome>
}
