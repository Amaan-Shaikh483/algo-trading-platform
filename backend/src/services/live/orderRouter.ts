import { BrokerError } from '../brokers/types'
import type { BrokerAdapter } from '../brokers/types'
import { logger } from '../../lib/logger'
import { auditLog, notify } from '../userEvents'
import { authorizeOrder, recordAuthorizedTrade } from '../risk/riskManager'
import type { OrderIntent } from '../risk/riskManager'
import * as ledger from './executionLedger'
import type { LiveExitReason } from './liveTypes'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ORDER ROUTER (spec §3.6) — the ONLY path from an engine decision to a fill.
 *
 *   intent ──▶ riskManager.authorizeOrder (ALWAYS; paper + live, entry + exit)
 *            ──▶ paper: simulated fill at the runtime's LTP reference
 *            ──▶ live:  BrokerAdapter.placeOrder (rate-limited ~9/s) + fill
 *                      confirmation poll + retry policy
 *
 * No module may place an order without constructing a RouterIntent and calling
 * executeIntent — the risk gate is structurally non-bypassable.
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface RouterIntent extends OrderIntent {
  orderType: 'MARKET' | 'LIMIT'
  productType: string
  /** Client idempotency ref — e.g. `${strategyId}:entry:${bucketEpoch}`. */
  clientRef: string
  /** Exit metadata (paper + live): forwarded to position close + notifications. */
  liveAdapter?: BrokerAdapter
  exitReason?: LiveExitReason
}

export interface RouterOutcome {
  outcome: 'filled' | 'placed' | 'blocked' | 'rejected' | 'failed'
  orderId: string
  /** Present when outcome === 'filled'. */
  fillPrice?: number
  filledQuantity?: number
  brokerOrderId?: string
  reason?: string
}

const FILL_POLL_ATTEMPTS = 4
const FILL_POLL_DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Paper fill model (documented v1): fills at the runtime's LTP reference with
 * zero slippage and zero fees — paper mode measures strategy signal quality
 * without cost assumptions; backtests remain the cost-accurate simulation.
 */
function paperFillPrice(intent: RouterIntent): number {
  return intent.approxPrice
}

export async function executeIntent(intent: RouterIntent): Promise<RouterOutcome> {
  // 1. Ledger row first (idempotent by client_ref) — an engine restart mid-bar
  //    re-derives the same intent and lands on the existing row instead of
  //    double-placing.
  const { row: order, created } = await ledger.openOrderIdempotent({
    userId: intent.userId,
    strategyId: intent.strategyId,
    clientRef: intent.clientRef,
    purpose: intent.purpose,
    mode: intent.mode,
    symbol: intent.symbol,
    symbolToken: intent.symbolToken,
    exchange: intent.exchange,
    transactionType: intent.side,
    orderType: intent.orderType,
    productType: intent.productType,
    quantity: intent.quantity,
    price: intent.approxPrice,
  })
  if (!created) {
    if (order.status === 'complete') {
      return { outcome: 'filled', orderId: order.id, fillPrice: Number(order.average_price), filledQuantity: order.filled_quantity }
    }
    if (order.status === 'blocked') return { outcome: 'blocked', orderId: order.id, reason: order.rejection_reason ?? 'blocked' }
    if (order.status === 'rejected') return { outcome: 'rejected', orderId: order.id, reason: order.rejection_reason ?? 'rejected' }
    // pending/open from a crashed attempt → treated as in-flight; the live
    // fill-poll / reconciliation loop converges it.
    if (intent.mode === 'paper') {
      // Paper orders never stay pending: a stale pending paper row means the
      // previous process died before writing the fill. Complete it now.
      const fillPrice = paperFillPrice(intent)
      await ledger.markOrderComplete(order.id, { averagePrice: fillPrice, filledQuantity: intent.quantity })
      return { outcome: 'filled', orderId: order.id, fillPrice, filledQuantity: intent.quantity }
    }
    return { outcome: 'placed', orderId: order.id, brokerOrderId: order.broker_order_id ?? undefined }
  }

  // 2. THE GATE — every order, no exceptions (spec §3.7 + user override).
  const decision = await authorizeOrder(intent)
  if (!decision.approved) {
    await ledger.markOrderBlocked(order.id, `${decision.code}: ${decision.reason}`)
    return { outcome: 'blocked', orderId: order.id, reason: decision.reason }
  }

  // 3. Paper fill.
  if (intent.mode === 'paper') {
    const fillPrice = paperFillPrice(intent)
    await ledger.markOrderComplete(order.id, { averagePrice: fillPrice, filledQuantity: intent.quantity })
    if (intent.purpose === 'entry') {
      await notify(
        intent.userId,
        'order_filled',
        `Paper fill: ${intent.side} ${intent.quantity} ${intent.symbol} @ ₹${fillPrice.toFixed(2)}`,
        `${intent.strategyName} · entry`,
      )
    }
    return { outcome: 'filled', orderId: order.id, fillPrice, filledQuantity: intent.quantity, brokerOrderId: undefined }
  }

  // 4. Live placement (spec §3.6 retry policy: retry once on price-freeze style
  //    rejections; session-expired re-auths once via the adapter then one retry).
  if (!intent.liveAdapter) {
    await ledger.markOrderRejected(order.id, 'No broker session attached to intent')
    return { outcome: 'failed', orderId: order.id, reason: 'no live adapter' }
  }
  const adapter = intent.liveAdapter
  const placeParams = {
    variety: 'NORMAL' as const,
    tradingsymbol: intent.symbol,
    symboltoken: intent.symbolToken,
    transactiontype: intent.side,
    exchange: intent.exchange as never,
    ordertype: intent.orderType,
    producttype: intent.productType as never,
    duration: 'DAY' as const,
    quantity: intent.quantity,
    ...(intent.orderType === 'LIMIT' ? { price: intent.approxPrice } : {}),
    // Docs: ordertag must be < 20 chars (error AB4008) — cap at 19.
    ordertag: intent.clientRef.slice(0, 19),
  }

  let brokerOrderId: string | undefined
  let placementError: string | undefined
  for (let attempt = 0; attempt < 2 && !brokerOrderId; attempt++) {
    try {
      if (attempt > 0) await sleep(3000)
      const placed = await adapter.placeOrder(placeParams)
      brokerOrderId = placed.brokerOrderId
    } catch (err) {
      placementError = (err as Error).message
      const kind = err instanceof BrokerError ? err.kind : 'unknown'
      const freezeLike = /freeze|circuit|price.{0,12}(range|band)/i.test(placementError)
      const retryable = (kind === 'rejected' && freezeLike) || kind === 'session_expired' || kind === 'network'
      if (attempt === 0 && retryable) {
        logger.warn('order placement retrying once', { orderId: order.id, kind, error: placementError })
        continue
      }
      await ledger.markOrderRejected(order.id, `${kind}: ${placementError}`)
      await notify(
        intent.userId,
        'order_rejected',
        `Live order rejected: ${intent.side} ${intent.quantity} ${intent.symbol}`,
        `${intent.strategyName} · ${placementError}`,
      )
      await auditLog(intent.userId, 'order.live_rejected', { strategyId: intent.strategyId, kind, error: placementError })
      return { outcome: 'rejected', orderId: order.id, reason: placementError }
    }
  }

  await ledger.markOrderOpen(order.id, brokerOrderId!)
  if (intent.purpose === 'entry') {
    // Account-scope trade counter increments on placement acceptance for live entries.
    await recordAuthorizedTrade(intent.userId)
    await notify(
      intent.userId,
      'order_placed',
      `Live order placed: ${intent.side} ${intent.quantity} ${intent.symbol}`,
      `${intent.strategyName} · broker order ${brokerOrderId}`,
    )
  }
  logger.info('live order placed', { orderId: order.id, brokerOrderId, mode: intent.mode, purpose: intent.purpose })

  // 5. Fill confirmation poll (MARKET fills land in seconds; the 60s
  //    reconciliation loop converges anything still open after this window).
  for (let i = 0; i < FILL_POLL_ATTEMPTS; i++) {
    await sleep(FILL_POLL_DELAY_MS)
    try {
      const details = await adapter.getOrderDetails(brokerOrderId!)
      if (!details) continue
      if (details.status === 'complete') {
        const avg = details.averagePrice > 0 ? details.averagePrice : intent.approxPrice
        await ledger.markOrderComplete(order.id, { averagePrice: avg, filledQuantity: details.filledQuantity || intent.quantity })
        return { outcome: 'filled', orderId: order.id, fillPrice: avg, filledQuantity: details.filledQuantity || intent.quantity, brokerOrderId }
      }
      if (details.status === 'rejected' || details.status === 'cancelled') {
        await ledger.markOrderRejected(order.id, `${details.rawStatus}${details.rejectionReason ? `: ${details.rejectionReason}` : ''}`)
        await notify(intent.userId, 'order_rejected', `Live order ${details.rawStatus}: ${intent.symbol}`, details.rejectionReason ?? '')
        return { outcome: 'rejected', orderId: order.id, reason: details.rejectionReason ?? details.rawStatus }
      }
    } catch (err) {
      logger.warn('fill poll failed (reconciliation will converge)', { orderId: order.id, error: (err as Error).message })
    }
  }
  return { outcome: 'placed', orderId: order.id, brokerOrderId }
}
