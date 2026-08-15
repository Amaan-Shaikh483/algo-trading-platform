import { describe, expect, it } from 'vitest'
import {
  blackScholesGreeks,
  blackScholesPrice,
  calculateDelta,
  cumulativeNormalDist,
} from './greeksCalculator'

describe('Black–Scholes calculator', () => {
  it('matches the canonical one-year ATM call/put values', () => {
    expect(blackScholesPrice(100, 100, 1, 0.05, 0.2, 'CE')).toBeCloseTo(10.4506, 3)
    expect(blackScholesPrice(100, 100, 1, 0.05, 0.2, 'PE')).toBeCloseTo(5.5735, 3)
    expect(calculateDelta(100, 100, 1, 0.05, 0.2, 'CE')).toBeCloseTo(0.6368, 3)
    expect(calculateDelta(100, 100, 1, 0.05, 0.2, 'PE')).toBeCloseTo(-0.3632, 3)
  })

  it('returns gamma, vega-per-point and theta-per-day in documented units', () => {
    const greeks = blackScholesGreeks(100, 100, 1, 0.05, 0.2, 'CE')
    expect(greeks.gamma).toBeCloseTo(0.01876, 4)
    expect(greeks.vega).toBeCloseTo(0.3752, 3)
    expect(greeks.theta).toBeCloseTo(-0.01757, 4)
  })

  it('converges to intrinsic value at expiry without NaN', () => {
    expect(blackScholesPrice(110, 100, 0, 0.06, 0.2, 'CE')).toBe(10)
    expect(blackScholesPrice(90, 100, 0, 0.06, 0.2, 'PE')).toBe(10)
    expect(blackScholesGreeks(100, 100, 0, 0.06, 0.2, 'CE')).toEqual({
      price: 0,
      delta: 0.5,
      gamma: 0,
      vega: 0,
      theta: 0,
    })
  })

  it('keeps the normal CDF symmetric', () => {
    for (const x of [-3, -1, 0, 1, 3]) {
      expect(cumulativeNormalDist(x) + cumulativeNormalDist(-x)).toBeCloseTo(1, 8)
    }
  })
})
