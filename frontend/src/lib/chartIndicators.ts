import type { Time } from 'lightweight-charts'
import type { OhlcvBar } from './chartApi'

export type LinePoint = { time: Time; value: number }

export function calculateEMA(data: OhlcvBar[], period: number): LinePoint[] {
  if (data.length === 0 || period < 1) return []
  const k = 2 / (period + 1)
  const out: LinePoint[] = []
  let ema = data[0].close
  data.forEach((bar, i) => {
    ema = i === 0 ? bar.close : bar.close * k + ema * (1 - k)
    if (i >= period - 1) out.push({ time: bar.time, value: ema })
  })
  return out
}

export function calculateRSI(data: OhlcvBar[], period = 14): LinePoint[] {
  if (data.length <= period) return []
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close
    if (change > 0) gains += change
    else losses += Math.abs(change)
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  const out: LinePoint[] = []
  for (let i = period; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    out.push({ time: data[i].time, value: 100 - 100 / (1 + rs) })
  }
  return out
}

export function calculateBollinger(data: OhlcvBar[], period = 20, stdDev = 2): {
  upper: LinePoint[]
  middle: LinePoint[]
  lower: LinePoint[]
} {
  const upper: LinePoint[] = []
  const middle: LinePoint[] = []
  const lower: LinePoint[] = []
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const sma = slice.reduce((sum, d) => sum + d.close, 0) / period
    const variance = slice.reduce((sum, d) => sum + (d.close - sma) ** 2, 0) / period
    const std = Math.sqrt(variance)
    const time = data[i].time
    upper.push({ time, value: sma + stdDev * std })
    middle.push({ time, value: sma })
    lower.push({ time, value: sma - stdDev * std })
  }
  return { upper, middle, lower }
}

/** Deterministic demo series so the chart still renders without a broker session. */
export function demoCandles(count = 80, start = 22_400): OhlcvBar[] {
  const out: OhlcvBar[] = []
  let price = start
  // Anchor on a weekday IST session so timestamps look like market hours.
  const open = Date.UTC(2026, 0, 12, 3, 45) // 09:15 IST
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 9) * 18 + ((i * 7) % 11) - 5
    const openPx = price
    const close = Math.max(50, openPx + drift)
    const high = Math.max(openPx, close) + 8 + (i % 5)
    const low = Math.min(openPx, close) - 7 - (i % 4)
    out.push({
      time: (Math.floor(open / 1000) + i * 300) as OhlcvBar['time'],
      open: round2(openPx),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: 80_000 + ((i * 13_000) % 900_000),
    })
    price = close
  }
  return out
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
