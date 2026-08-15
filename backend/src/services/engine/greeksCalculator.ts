/**
 * Black–Scholes pricing and first-order Greeks.
 *
 * Rates and volatility are decimal annual values (`0.06` = 6%). Time is in
 * years. Vega is returned per one volatility percentage point and theta per
 * calendar day, matching the units normally displayed in an option chain.
 */

export type BlackScholesOptionType = 'CE' | 'PE'

export interface OptionGreeks {
  price: number
  delta: number
  gamma: number
  vega: number
  theta: number
}

const DAYS_PER_YEAR = 365
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI)

/** Standard-normal probability density function. */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_TWO_PI
}

/**
 * Standard-normal CDF (Abramowitz & Stegun 7.1.26). The approximation error
 * is below 7.5e-8, more than sufficient for premium/Greek calculations.
 */
export function cumulativeNormalDist(x: number): number {
  if (x === Infinity) return 1
  if (x === -Infinity) return 0
  const abs = Math.abs(x)
  const t = 1 / (1 + 0.2316419 * abs)
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const cdf = 1 - normalPdf(abs) * poly
  return x >= 0 ? cdf : 1 - cdf
}

function assertInputs(S: number, K: number, T: number, r: number, sigma: number): void {
  if (!(S > 0) || !Number.isFinite(S)) throw new RangeError('Underlying price S must be finite and > 0')
  if (!(K > 0) || !Number.isFinite(K)) throw new RangeError('Strike K must be finite and > 0')
  if (!Number.isFinite(T)) throw new RangeError('Time T must be finite')
  if (!Number.isFinite(r)) throw new RangeError('Risk-free rate r must be finite')
  if (!Number.isFinite(sigma) || sigma < 0) throw new RangeError('Volatility sigma must be finite and >= 0')
}

function intrinsic(S: number, K: number, type: BlackScholesOptionType): number {
  return type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S)
}

function expiryDelta(S: number, K: number, type: BlackScholesOptionType): number {
  if (S === K) return type === 'CE' ? 0.5 : -0.5
  if (type === 'CE') return S > K ? 1 : 0
  return S < K ? -1 : 0
}

function dValues(S: number, K: number, T: number, r: number, sigma: number): { d1: number; d2: number } {
  const rootT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * rootT)
  return { d1, d2: d1 - sigma * rootT }
}

export function blackScholesPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: BlackScholesOptionType,
): number {
  assertInputs(S, K, T, r, sigma)
  if (T <= 0) return intrinsic(S, K, type)

  // Zero-volatility limit: discounted strike versus deterministic forward.
  if (sigma === 0) {
    const discountedStrike = K * Math.exp(-r * T)
    return type === 'CE' ? Math.max(0, S - discountedStrike) : Math.max(0, discountedStrike - S)
  }

  const { d1, d2 } = dValues(S, K, T, r, sigma)
  const discountedStrike = K * Math.exp(-r * T)
  return type === 'CE'
    ? S * cumulativeNormalDist(d1) - discountedStrike * cumulativeNormalDist(d2)
    : discountedStrike * cumulativeNormalDist(-d2) - S * cumulativeNormalDist(-d1)
}

export function calculateDelta(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: BlackScholesOptionType,
): number {
  assertInputs(S, K, T, r, sigma)
  if (T <= 0 || sigma === 0) return expiryDelta(S, K * Math.exp(-r * Math.max(T, 0)), type)
  const { d1 } = dValues(S, K, T, r, sigma)
  return type === 'CE' ? cumulativeNormalDist(d1) : cumulativeNormalDist(d1) - 1
}

export function calculateGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  assertInputs(S, K, T, r, sigma)
  if (T <= 0 || sigma === 0) return 0
  const { d1 } = dValues(S, K, T, r, sigma)
  return normalPdf(d1) / (S * sigma * Math.sqrt(T))
}

export function calculateVega(S: number, K: number, T: number, r: number, sigma: number): number {
  assertInputs(S, K, T, r, sigma)
  if (T <= 0 || sigma === 0) return 0
  const { d1 } = dValues(S, K, T, r, sigma)
  // Raw derivative is per +1.00 volatility; divide by 100 for a +1 vol-point move.
  return (S * normalPdf(d1) * Math.sqrt(T)) / 100
}

export function calculateTheta(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: BlackScholesOptionType,
): number {
  assertInputs(S, K, T, r, sigma)
  if (T <= 0 || sigma === 0) return 0
  const { d1, d2 } = dValues(S, K, T, r, sigma)
  const decay = -(S * normalPdf(d1) * sigma) / (2 * Math.sqrt(T))
  const carry = r * K * Math.exp(-r * T)
  const annual =
    type === 'CE'
      ? decay - carry * cumulativeNormalDist(d2)
      : decay + carry * cumulativeNormalDist(-d2)
  return annual / DAYS_PER_YEAR
}

export function blackScholesGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: BlackScholesOptionType,
): OptionGreeks {
  return {
    price: blackScholesPrice(S, K, T, r, sigma, type),
    delta: calculateDelta(S, K, T, r, sigma, type),
    gamma: calculateGamma(S, K, T, r, sigma),
    vega: calculateVega(S, K, T, r, sigma),
    theta: calculateTheta(S, K, T, r, sigma, type),
  }
}
