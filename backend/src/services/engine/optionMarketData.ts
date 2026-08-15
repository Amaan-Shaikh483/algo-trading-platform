import { normalizeOptionExecution } from '@algo/rule-schema'
import type { ExpiryType, StrategyRuleLeg, StrategyRules } from '@algo/rule-schema'
import type { Candle, OptionChainData, OptionContractType } from '../brokers/types'
import { blackScholesGreeks, blackScholesPrice } from './greeksCalculator'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const EXPIRY_HOUR_IST = 15
const EXPIRY_MINUTE_IST = 30
const NSE_TUESDAY_TRANSITION = '2025-09-01'

export interface SyntheticOptionContext {
  exchange: string
  instrument: string
  strikeStep?: number
}

export function optionContractId(
  optionType: OptionContractType,
  strike: number,
  expiry: Date,
): string {
  return `${optionType}:${strike}:${expiry.toISOString()}`
}

/** Known index strike intervals; a price-based fallback keeps custom indices usable. */
export function strikeStepForInstrument(instrument: string, underlying: number): number {
  const normalized = instrument.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (normalized.includes('BANKNIFTY') || normalized.includes('NIFTYBANK') || normalized.includes('SENSEX')) return 100
  if (normalized.includes('FINNIFTY') || normalized.includes('NIFTYFIN') || normalized.includes('NIFTY')) return 50
  if (underlying >= 10_000) return 50
  if (underlying >= 1_000) return 20
  return 10
}

function istDateParts(time: Date): { year: number; month: number; day: number; weekday: number; dateKey: string } {
  const shifted = new Date(time.getTime() + IST_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    dateKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

function istExpiryInstant(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, EXPIRY_HOUR_IST, EXPIRY_MINUTE_IST) - IST_OFFSET_MS)
}

function exchangeExpiryWeekday(exchange: string, at: Date): number {
  const { dateKey } = istDateParts(at)
  // Current exchange rules: NSE Tuesday and BSE Thursday from Sep 2025.
  // Before the transition they were NSE Thursday and BSE Tuesday.
  if (dateKey >= NSE_TUESDAY_TRANSITION) return exchange.toUpperCase().startsWith('B') ? 4 : 2
  return exchange.toUpperCase().startsWith('B') ? 2 : 4
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function lastWeekdayOfMonth(year: number, month: number, targetWeekday: number): number {
  const last = daysInMonth(year, month)
  const weekday = new Date(Date.UTC(year, month, last)).getUTCDay()
  return last - ((weekday - targetWeekday + 7) % 7)
}

/**
 * Resolve the nominal exchange expiry. Holiday adjustments require an
 * exchange calendar and are intentionally left to real contract metadata.
 */
export function resolveNominalExpiry(at: Date, expiryType: ExpiryType, exchange: string): Date {
  const p = istDateParts(at)
  const targetWeekday = exchangeExpiryWeekday(exchange, at)

  if (expiryType === 'WEEKLY') {
    let delta = (targetWeekday - p.weekday + 7) % 7
    let expiry = istExpiryInstant(p.year, p.month, p.day + delta)
    if (expiry.getTime() <= at.getTime()) {
      delta += 7
      expiry = istExpiryInstant(p.year, p.month, p.day + delta)
    }
    return expiry
  }

  let year = p.year
  let month = p.month
  let day = lastWeekdayOfMonth(year, month, targetWeekday)
  let expiry = istExpiryInstant(year, month, day)
  if (expiry.getTime() <= at.getTime()) {
    month++
    if (month > 11) {
      year++
      month = 0
    }
    day = lastWeekdayOfMonth(year, month, targetWeekday)
    expiry = istExpiryInstant(year, month, day)
  }
  return expiry
}

export function optionTypeForLeg(leg: StrategyRuleLeg): OptionContractType {
  return leg.optionType === 'CALL' ? 'CE' : 'PE'
}

/** Relative strike semantics used by the builder's ATM/ITM/OTM controls. */
export function strikeForLeg(leg: StrategyRuleLeg, underlying: number, step: number): number {
  const atm = Math.round(underlying / step) * step
  const type = optionTypeForLeg(leg)
  const strikeType = `${leg.strikeType} ${leg.strikeCriteria}`.toUpperCase()
  if (strikeType.includes('OTM')) return atm + (type === 'CE' ? step : -step)
  if (strikeType.includes('ITM')) return atm + (type === 'CE' ? -step : step)
  return atm
}

function optionPriceAt(
  underlying: number,
  strike: number,
  at: Date,
  expiry: Date,
  rate: number,
  iv: number,
  type: OptionContractType,
): number {
  const T = Math.max(0, (expiry.getTime() - at.getTime()) / YEAR_MS)
  return blackScholesPrice(Math.max(underlying, 0.01), strike, T, rate, iv, type)
}

/** Build a premium OHLC + Greeks snapshot for one fixed contract. */
export function synthesizeOptionContract(
  candle: Candle,
  input: {
    strike: number
    optionType: OptionContractType
    expiryType: ExpiryType
    expiry: Date
    riskFreeRate: number
    impliedVolatility: number
  },
): OptionChainData {
  const { strike, optionType, expiryType, expiry, riskFreeRate, impliedVolatility } = input
  const timeToExpiry = Math.max(0, (expiry.getTime() - candle.time.getTime()) / YEAR_MS)
  const values = [candle.open, candle.high, candle.low, candle.close].map((s) =>
    optionPriceAt(s, strike, candle.time, expiry, riskFreeRate, impliedVolatility, optionType),
  )
  const closeGreeks = blackScholesGreeks(
    Math.max(candle.close, 0.01),
    strike,
    timeToExpiry,
    riskFreeRate,
    impliedVolatility,
    optionType,
  )
  // A synthetic series has no option-volume model. Keeping underlying volume
  // makes volume-based conditions explicit but deterministic.
  return {
    contractId: optionContractId(optionType, strike, expiry),
    source: 'synthetic',
    underlying: candle.close,
    strike,
    optionType,
    expiryType,
    expiry,
    premium: closeGreeks.price,
    open: values[0],
    high: Math.max(...values),
    low: Math.min(...values),
    close: closeGreeks.price,
    volume: candle.volume,
    delta: closeGreeks.delta,
    gamma: closeGreeks.gamma,
    vega: closeGreeks.vega,
    theta: closeGreeks.theta,
    impliedVol: impliedVolatility,
    timeToExpiry: timeToExpiry * 365,
  }
}

/** Convert a chain snapshot into the Candle shape consumed by indicators/exits. */
export function optionDataCandle(time: Date, data: OptionChainData): Candle {
  return {
    time,
    open: data.open,
    high: data.high,
    low: data.low,
    close: data.close,
    volume: data.volume,
  }
}

/**
 * Add a compact synthetic chain to underlying history when the broker cannot
 * supply expired option contracts. Three strikes around each requested leg are
 * enough to resolve ATM/ITM/OTM while avoiding a huge all-strikes data set.
 * Existing market optionChains are never overwritten.
 */
export function attachSyntheticOptionChains(
  candles: Candle[],
  rules: StrategyRules,
  context: SyntheticOptionContext,
): Candle[] {
  const activeLegs = (rules.legs ?? []).filter((leg) => leg.active)
  if (activeLegs.length === 0) return candles
  const cfg = normalizeOptionExecution(rules)

  return candles.map((candle) => {
    if (candle.optionChains && candle.optionChains.size > 0) return candle
    const step = context.strikeStep ?? strikeStepForInstrument(context.instrument, candle.close)
    const chain = new Map<string, OptionChainData>()
    for (const leg of activeLegs) {
      const expiry = resolveNominalExpiry(candle.time, leg.expiry, context.exchange)
      const center = strikeForLeg(leg, candle.close, step)
      // Include neighbors so a fixed position remains available through normal
      // intraday moves; the engine can synthesize a missing fixed strike on
      // demand after an unusually large move.
      for (let offset = -2; offset <= 2; offset++) {
        const strike = center + offset * step
        if (strike <= 0) continue
        const data = synthesizeOptionContract(candle, {
          strike,
          optionType: optionTypeForLeg(leg),
          expiryType: leg.expiry,
          expiry,
          riskFreeRate: cfg.riskFreeRate,
          impliedVolatility: cfg.impliedVolatility,
        })
        chain.set(data.contractId, data)
      }
    }
    return { ...candle, optionChains: chain }
  })
}

/** Find the contract selected by a leg from a real or synthesized chain. */
export function selectOptionContract(candle: Candle, leg: StrategyRuleLeg): OptionChainData | undefined {
  const candidates = [...(candle.optionChains?.values() ?? [])].filter(
    (data) => data.optionType === optionTypeForLeg(leg) && data.expiryType === leg.expiry,
  )
  if (candidates.length === 0) return undefined
  const strikes = [...new Set(candidates.map((data) => data.strike))].sort((a, b) => a - b)
  const inferredStep = strikes.length > 1
    ? Math.min(...strikes.slice(1).map((strike, i) => strike - strikes[i]).filter((v) => v > 0))
    : Math.max(1, Math.round(candle.close / 100))
  const target = strikeForLeg(leg, candle.close, inferredStep)
  return candidates.reduce((best, current) =>
    Math.abs(current.strike - target) < Math.abs(best.strike - target) ? current : best,
  )
}
