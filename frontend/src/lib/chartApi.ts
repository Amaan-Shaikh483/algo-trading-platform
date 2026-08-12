import { apiGet } from './api'
import type { Time } from 'lightweight-charts'

export const CHART_INTERVALS = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '1D'] as const
export type ChartInterval = (typeof CHART_INTERVALS)[number]

export const CHART_INTERVAL_LABELS: Record<ChartInterval, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '10m': '10m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '1D': '1D',
}

export type ChartStyle = 'candle' | 'bar' | 'area'

export interface OhlcvBar {
  time: Time
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartCandlesResponse {
  exchange: string
  token: string
  interval: ChartInterval
  source: 'broker'
  from: string
  to: string
  candles: OhlcvBar[]
}

export const chartApi = {
  candles: (opts: { exchange: string; token: string; interval: ChartInterval; from?: string; to?: string }) => {
    const params = new URLSearchParams({
      exchange: opts.exchange,
      token: opts.token,
      interval: opts.interval,
    })
    if (opts.from) params.set('from', opts.from)
    if (opts.to) params.set('to', opts.to)
    return apiGet<ChartCandlesResponse>(`/api/instruments/candles?${params.toString()}`)
  },
}
