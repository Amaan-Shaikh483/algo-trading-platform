import { describe, expect, it } from 'vitest'
import { defaultRange, toChartTime, CHART_LOOKBACK_DAYS } from './chartService'

describe('chartService time mapping', () => {
  it('emits UTC seconds for intraday intervals', () => {
    const d = new Date('2026-01-15T09:15:00+05:30')
    expect(toChartTime(d, '5m')).toBe(Math.floor(d.getTime() / 1000))
    expect(toChartTime(d, '1m')).toBe(Math.floor(d.getTime() / 1000))
  })

  it('emits an IST calendar date for daily bars', () => {
    // 15 Jan 2026 23:30 IST is still 15 Jan in IST, 15 Jan 18:00 UTC
    const lateIst = new Date('2026-01-15T23:30:00+05:30')
    expect(toChartTime(lateIst, '1D')).toBe('2026-01-15')
    // 16 Jan 2026 00:30 IST is the next IST day
    const nextIst = new Date('2026-01-16T00:30:00+05:30')
    expect(toChartTime(nextIst, '1D')).toBe('2026-01-16')
  })

  it('keeps default lookbacks inside known SmartAPI chunk sizes', () => {
    const now = new Date('2026-08-12T10:00:00Z')
    const { from, to } = defaultRange('5m', now)
    expect(to.getTime()).toBe(now.getTime())
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(CHART_LOOKBACK_DAYS['5m'])
    expect(CHART_LOOKBACK_DAYS['5m']).toBeLessThanOrEqual(99)
    expect(CHART_LOOKBACK_DAYS['1D']).toBeLessThanOrEqual(1999)
  })
})
