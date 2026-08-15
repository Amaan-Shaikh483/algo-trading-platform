import { SMA, EMA, WMA, RSI, MACD, BollingerBands, ATR, Stochastic, ADX, doji, bullishengulfingpattern, bearishengulfingpattern } from 'technicalindicators'
import { INDICATORS, indicatorInstanceId } from '@algo/rule-schema'
import type { IndicatorKey, Operand, StrategyRules } from '@algo/rule-schema'
import type { Candle } from '../brokers/types'

/**
 * Incremental indicator runtime (spec §3.5: indicators recompute bar-by-bar,
 * NOT over the whole series each bar — and CRITICALLY, this exact runtime is
 * also used by the live engine in step 7, so backtest/live parity holds by
 * construction).
 *
 * - technicalindicators nextValue() powers everything it supports (verified
 *   v3.1.0): SMA/EMA/WMA/RSI/MACD/Bollinger/ATR/Stochastic/ADX.
 * - VWAP is custom: session-anchored cumulative (resets each IST trading day).
 * - Supertrend is custom: classic ATR-based algorithm (absent from the lib).
 * - Candle patterns use bounded rolling windows (constant work per bar).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCalc = { nextValue: (input: any) => any }

interface Calculator {
  update: (candle: Candle) => Record<string, number | undefined>
}

// ── Session-aware helpers ────────────────────────────────────────────────────

const istDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
export function istDayKey(time: Date): string {
  return istDayFmt.format(time)
}

/** Minutes since IST midnight — for time square-off comparisons. */
export function istMinutesOfDay(time: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(time)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// ── Custom calculators ───────────────────────────────────────────────────────

function makeSessionVwap(): Calculator {
  let day = ''
  let cumPV = 0
  let cumV = 0
  return {
    update(candle) {
      const key = istDayKey(candle.time)
      if (key !== day) {
        day = key
        cumPV = 0
        cumV = 0
      }
      const typical = (candle.high + candle.low + candle.close) / 3
      cumPV += typical * candle.volume
      cumV += candle.volume
      return { value: cumV > 0 ? cumPV / cumV : undefined }
    },
  }
}

/** Classic Supertrend: trend-following trailing line from ATR bands. */
function makeSupertrend(period: number, multiplier: number): Calculator {
  const atr = new ATR({ high: [], low: [], close: [], period })
  let prevUpper: number | undefined
  let prevLower: number | undefined
  let prevClose: number | undefined
  let direction: 1 | -1 = -1
  let line: number | undefined
  return {
    update(candle) {
      const atrValue = atr.nextValue({ high: candle.high, low: candle.low, close: candle.close }) as number | undefined
      if (atrValue == null) {
        prevClose = candle.close
        return { value: undefined, direction: undefined }
      }
      const mid = (candle.high + candle.low) / 2
      const basicUpper = mid + multiplier * atrValue
      const basicLower = mid - multiplier * atrValue
      const finalUpper =
        prevUpper == null || prevClose == null ? basicUpper : basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper
      const finalLower =
        prevLower == null || prevClose == null ? basicLower : basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower
      if (direction === -1 && candle.close > finalUpper) direction = 1
      else if (direction === 1 && candle.close < finalLower) direction = -1
      line = direction === 1 ? finalLower : finalUpper
      prevUpper = finalUpper
      prevLower = finalLower
      prevClose = candle.close
      return { value: line, direction }
    },
  }
}

/** Rolling 5-candle window feeding the pattern detectors (bounded work per bar). */
function makePatternCalc(kind: 'bullish_engulfing' | 'bearish_engulfing' | 'doji'): Calculator {
  const window: Candle[] = []
  return {
    update(candle) {
      window.push(candle)
      if (window.length > 3) window.shift()
      let detected = false
      if (kind === 'doji') {
        detected = doji({ open: [candle.open], high: [candle.high], low: [candle.low], close: [candle.close] })
      } else if (window.length >= 2) {
        const input = {
          open: window.map((c) => c.open),
          high: window.map((c) => c.high),
          low: window.map((c) => c.low),
          close: window.map((c) => c.close),
        }
        const out = kind === 'bullish_engulfing' ? bullishengulfingpattern(input) : bearishengulfingpattern(input)
        detected = out[out.length - 1] === true
      }
      return { value: detected ? 1 : 0 }
    },
  }
}

// ── Runtime ──────────────────────────────────────────────────────────────────

export interface IndicatorSpec {
  instanceId: string
  key: IndicatorKey
  params: Record<string, number>
}

function instantiate(spec: IndicatorSpec): Calculator {
  const p = spec.params
  let calc: AnyCalc | null = null
  switch (spec.key) {
    case 'sma':
      calc = new SMA({ values: [], period: p.period })
      return { update: (c) => ({ value: calc!.nextValue(c.close) ?? undefined }) }
    case 'ema':
      calc = new EMA({ values: [], period: p.period })
      return { update: (c) => ({ value: calc!.nextValue(c.close) ?? undefined }) }
    case 'wma':
      calc = new WMA({ values: [], period: p.period })
      return { update: (c) => ({ value: calc!.nextValue(c.close) ?? undefined }) }
    case 'rsi':
      calc = new RSI({ values: [], period: p.period })
      return { update: (c) => ({ value: calc!.nextValue(c.close) ?? undefined }) }
    case 'macd':
      calc = new MACD({ values: [], fastPeriod: p.fastPeriod, slowPeriod: p.slowPeriod, signalPeriod: p.signalPeriod, SimpleMAOscillator: false, SimpleMASignal: false })
      return {
        update: (c) => {
          const out = calc!.nextValue(c.close)
          return out ? { macd: out.MACD, signal: out.signal, histogram: out.histogram } : {}
        },
      }
    case 'bollinger':
      calc = new BollingerBands({ values: [], period: p.period, stdDev: p.stdDev })
      return {
        update: (c) => {
          const out = calc!.nextValue(c.close)
          return out ? { upper: out.upper, middle: out.middle, lower: out.lower, pb: out.pb } : {}
        },
      }
    case 'atr':
      calc = new ATR({ high: [], low: [], close: [], period: p.period })
      return { update: (c) => ({ value: calc!.nextValue({ high: c.high, low: c.low, close: c.close }) ?? undefined }) }
    case 'stochastic':
      calc = new Stochastic({ high: [], low: [], close: [], period: p.period, signalPeriod: p.signalPeriod })
      return {
        update: (c) => {
          const out = calc!.nextValue({ high: c.high, low: c.low, close: c.close })
          return out ? { k: out.k, d: out.d } : {}
        },
      }
    case 'adx':
      calc = new ADX({ high: [], low: [], close: [], period: p.period })
      return {
        update: (c) => {
          const out = calc!.nextValue({ high: c.high, low: c.low, close: c.close })
          return out ? { adx: out.adx, pdi: out.pdi, mdi: out.mdi } : {}
        },
      }
    case 'vwap':
      return makeSessionVwap()
    case 'supertrend':
      return makeSupertrend(p.period, p.multiplier)
    case 'bullish_engulfing':
      return makePatternCalc('bullish_engulfing')
    case 'bearish_engulfing':
      return makePatternCalc('bearish_engulfing')
    case 'doji':
      return makePatternCalc('doji')
    default:
      throw new Error(`No runtime for indicator '${String(spec.key)}'`)
  }
}

const HISTORY_DEPTH = 3

export class IndicatorRuntime {
  private calcs = new Map<string, Calculator>()
  private history = new Map<string, Record<string, number[]>>()

  constructor(readonly specs: IndicatorSpec[]) {
    for (const spec of specs) {
      this.calcs.set(spec.instanceId, instantiate(spec))
      const def = INDICATORS[spec.key]
      this.history.set(spec.instanceId, Object.fromEntries(def.outputs.map((o) => [o.key, []])))
    }
  }

  /** Feed one closed candle; afterwards current values are for that bar. */
  update(candle: Candle): void {
    for (const [id, calc] of this.calcs) {
      const outputs = calc.update(candle)
      const hist = this.history.get(id)!
      for (const outputKey of Object.keys(hist)) {
        const arr = hist[outputKey]
        arr.unshift(outputs[outputKey] ?? Number.NaN)
        if (arr.length > HISTORY_DEPTH) arr.pop()
      }
    }
  }

  /** indicator value at offset 0 (current bar) / 1 (previous bar). undefined → NaN (warmup). */
  value(instanceId: string, output: string, offset = 0): number {
    const arr = this.history.get(instanceId)?.[output]
    const v = arr?.[offset]
    return typeof v === 'number' ? v : Number.NaN
  }
}

/** Build the exact indicator set a strategy needs (deduped by params). */
export function collectIndicatorSpecs(rules: StrategyRules): IndicatorSpec[] {
  const specs = new Map<string, IndicatorSpec>()
  const addIndicator = (key: IndicatorKey, params: Record<string, number>) => {
    const instanceId = indicatorInstanceId(key, params)
    if (!specs.has(instanceId)) specs.set(instanceId, { instanceId, key, params })
  }
  const addOperand = (op: Operand) => {
    if (op.kind === 'indicator') addIndicator(op.indicator, op.params)
  }
  const groups = [rules.entryConditions, rules.longEntryConditions, rules.shortEntryConditions]
  for (const group of groups) {
    for (const c of group?.conditions ?? []) {
      addOperand(c.left)
      addOperand(c.right)
    }
  }
  if (rules.exit.stopLoss?.type === 'atr') {
    addIndicator('atr', { period: rules.exit.stopLoss.atrPeriod ?? 14 })
  }
  return [...specs.values()]
}

export { indicatorInstanceId }
