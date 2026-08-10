import Bottleneck from 'bottleneck'

/**
 * Rate-limit discipline, verified against the official SmartAPI RateLimit doc
 * (https://smartapi.angelbroking.com/docs/RateLimit, fetched 2026-08-06):
 *
 * | API                                  | Docs limit                        | Limiter below            |
 * |--------------------------------------|-----------------------------------|--------------------------|
 * | placeOrder + modifyOrder + cancelOrder | 9/sec CUMULATIVE, 500/min, 1000/hr | tradingLimiter (+ minute window) |
 * | getOrderBook                         | 1/sec                             | portfolioLimiter         |
 * | getTradeBook                         | 1/sec                             | portfolioLimiter         |
 * | getPosition                          | 1/sec                             | portfolioLimiter         |
 * | getHolding / getAllHolding           | 1/sec                             | portfolioLimiter         |
 * | getRMS                               | 2/sec                             | portfolioLimiter (1/s, conservative) |
 * | getProfile                           | 3/sec                             | generalLimiter           |
 * | individual order details             | 10/sec                            | generalLimiter           |
 * | market/v1/quote (marketData)         | 10/sec in the table; the MarketData page itself states 1 req/sec & 50 tokens/request | marketDataLimiter (conservative: 1/sec) |
 * | historical getCandleData             | 3/sec, 150/min, 5000/hr           | historicalLimiter (+ minute & hour windows) |
 *
 * Rate limit is enforced per client code; limits below apply process-wide, so
 * they hold even when many strategies share one user's connection.
 * When a window bucket is empty Bottleneck QUEUES work until the next window
 * instead of letting SmartAPI answer 403 Access Denied.
 * Window values are docs constants; per-second knobs stay env-tunable.
 */

/** Order placement / modify / cancel — docs: cumulative 9/sec across all three. 115ms ⇒ ≤8.7/sec. */
export const tradingLimiter = new Bottleneck({
  maxConcurrent: parseInt(process.env.SMARTAPI_TRADING_CONCURRENCY ?? '5', 10),
  minTime: parseInt(process.env.SMARTAPI_TRADING_MIN_TIME_MS ?? '115', 10), // ~8.7 req/sec, safely under the cumulative 9/sec
})

/** Docs minute window for order APIs: 500/min (hourly 1000 is guarded structurally by the risk manager's trade caps). */
export const tradingMinuteLimiter = new Bottleneck({
  reservoir: parseInt(process.env.SMARTAPI_TRADING_PER_MIN ?? '500', 10),
  reservoirRefreshInterval: 60_000,
  reservoirRefreshAmount: parseInt(process.env.SMARTAPI_TRADING_PER_MIN ?? '500', 10),
})

/** marketData (LTP/OHLC/FULL quote) — MarketData doc page: 1 req/sec, max 50 tokens/request. */
export const marketDataLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: parseInt(process.env.SMARTAPI_MARKET_DATA_MIN_TIME_MS ?? '1000', 10), // 1 req/sec
})

/** Historical candle data — docs: 3/sec. */
export const historicalLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: parseInt(process.env.SMARTAPI_HISTORICAL_MIN_TIME_MS ?? '350', 10), // ~2.86 req/sec
})

/** Docs windows for historical: 150/min and 5000/hr — chain both ahead of the per-second gate. */
export const historicalMinuteLimiter = new Bottleneck({
  reservoir: 150,
  reservoirRefreshInterval: 60_000,
  reservoirRefreshAmount: 150,
})
export const historicalHourLimiter = new Bottleneck({
  reservoir: 5000,
  reservoirRefreshInterval: 3_600_000,
  reservoirRefreshAmount: 5000,
})

/**
 * Order/trade book, positions, holdings, RMS — docs cap these at 1/sec each
 * (RMS at 2/sec; sharing this 1/sec gate stays compliant and simple).
 */
export const portfolioLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: parseInt(process.env.SMARTAPI_PORTFOLIO_MIN_TIME_MS ?? '1000', 10), // 1 req/sec
})

/** getProfile (3/sec) + individual order details (10/sec) + misc — ≤3/sec keeps every member compliant. */
export const generalLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: parseInt(process.env.SMARTAPI_GENERAL_MIN_TIME_MS ?? '334', 10), // ≤3 req/sec
})
