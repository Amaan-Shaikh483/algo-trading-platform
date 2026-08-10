import type { StrategyRuleLeg } from '@algo/rule-schema'
import { hhmmToMinutes, istDayKey, istMinutesOfDay } from './indicatorEngine'
import type { Candle } from '../brokers/types'

/**
 * Time-triggered leg scheduling — SHARED by the backtest engine and the live
 * strategy runtime so backtest ↔ live parity holds for time-based option legs.
 *
 * Execution model (documented simplification):
 *  - Each ACTIVE leg that carries an `entryTime` schedules at most ONE entry
 *    per IST trading day.
 *  - A leg "fires" on the first candle whose close-time (IST) is at/after the
 *    leg's entry time, while the strategy is FLAT. Fills use that candle's
 *    close (the live worker's market order placed at candle close executes
 *    within a tick of close).
 *  - A leg's BUY/SELL position maps to LONG/SHORT and `qty` drives size.
 *  - When multiple legs are due on the same candle, the earliest entry time
 *    wins (ties break by legNumber) — one position at a time in engine v1.
 */

/** @returns the leg that should trigger on `candle`, or undefined. */
export function pickScheduledLeg(
  legs: StrategyRuleLeg[] | undefined,
  candle: Candle,
  fired: ReadonlySet<string>,
): StrategyRuleLeg | undefined {
  if (!legs) return undefined
  const dayKey = istDayKey(candle.time)
  const barMinutes = istMinutesOfDay(candle.time)
  let chosen: StrategyRuleLeg | undefined
  for (const leg of legs) {
    if (!leg.active || !leg.entryTime) continue
    const key = `${dayKey}:${leg.legNumber}`
    if (fired.has(key)) continue
    const legMinutes = hhmmToMinutes(leg.entryTime)
    if (legMinutes >= 0 && barMinutes >= legMinutes) {
      if (!chosen || legMinutes < hhmmToMinutes(chosen.entryTime!)) chosen = leg
    }
  }
  return chosen
}

/** Mark a leg as fired for the day (call once it has triggered). */
export function markLegFired(leg: StrategyRuleLeg, candle: Candle, fired: Set<string>): void {
  const dayKey = istDayKey(candle.time)
  fired.add(`${dayKey}:${leg.legNumber}`)
}

/** True when the strategy has any active time-triggered leg. */
export function hasTimeTriggeredLegs(legs: StrategyRuleLeg[] | undefined): boolean {
  return (legs ?? []).some((l) => l.active && !!l.entryTime)
}

/** Map a leg position+option type onto a LONG/SHORT engine side (v1 proxy). */
export function legSide(leg: StrategyRuleLeg): 'LONG' | 'SHORT' {
  // BUY premium (long options) → LONG; SELL premium (short options) → SHORT.
  return leg.position === 'BUY' ? 'LONG' : 'SHORT'
}
