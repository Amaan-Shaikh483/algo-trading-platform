import type { BrokerAdapter } from '../brokers/types'
import { getServiceClient } from '../../supabase/client'
import { logger } from '../../lib/logger'
import { notify } from '../userEvents'
import { recordClosedTrade } from '../risk/riskManager'
import * as ledger from './executionLedger'
import type { StrategyRuntime } from './strategyRuntime'

/**
 * Order/position reconciliation (spec §3.6) — every 60s during market hours:
 *   1. our live 'pending'/'open' orders vs the broker order book → catch fills
 *      the 8s placement poll missed (converges runtime state via
 *      notifyOrderSettled), and broker-side rejections/cancels;
 *   2. our open LIVE positions vs the broker position book → a position flat
 *      on the broker but open in our DB was closed externally (manual app
 *      intervention): close our side at LTP, book the trade, flag the drift;
 *   3. broker exposure on tokens our engine has NO open position for → only
 *      NOTIFIED (never auto-adopted — could be the user's manual trade).
 */

export interface ReconcileSummary {
  userId: string
  ordersSynced: number
  positionsClosed: number
  driftFlags: string[]
}

export async function reconcileUser(
  userId: string,
  adapter: BrokerAdapter,
  runtimeFor: (strategyId: string) => StrategyRuntime | undefined,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { userId, ordersSynced: 0, positionsClosed: 0, driftFlags: [] }
  const supabase = getServiceClient()

  // ── 1. order book convergence ──
  const [brokerOrders, ourOpen] = await Promise.all([
    adapter.getOrderBook(),
    supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .eq('mode', 'live')
      .in('status', ['pending', 'open']),
  ])
  const byBrokerId = new Map(brokerOrders.map((o) => [o.brokerOrderId, o]))

  for (const order of ourOpen.data ?? []) {
    const broker = order.broker_order_id ? byBrokerId.get(order.broker_order_id) : undefined
    if (!broker) continue
    if (broker.status === 'complete') {
      const avg = broker.averagePrice > 0 ? broker.averagePrice : Number(order.price ?? 0)
      await ledger.markOrderComplete(order.id, { averagePrice: avg, filledQuantity: broker.filledQuantity || order.quantity })
      summary.ordersSynced++
      const runtime = order.strategy_id ? runtimeFor(order.strategy_id) : undefined
      if (runtime?.awaitingSettlement) {
        await runtime.notifyOrderSettled({
          purpose: order.purpose,
          status: 'complete',
          average_price: avg,
          filled_quantity: broker.filledQuantity || order.quantity,
        })
      }
      logger.info('order converged complete by reconciliation', { orderId: order.id, avg })
    } else if (broker.status === 'rejected' || broker.status === 'cancelled') {
      if (broker.status === 'rejected') await ledger.markOrderRejected(order.id, broker.rejectionReason ?? broker.rawStatus)
      else await ledger.markOrderCancelled(order.id)
      summary.ordersSynced++
      const runtime = order.strategy_id ? runtimeFor(order.strategy_id) : undefined
      if (runtime?.awaitingSettlement) {
        await runtime.notifyOrderSettled({ purpose: order.purpose, status: broker.status, average_price: null, filled_quantity: 0 })
      }
      await notify(userId, 'order_rejected', `Order ${broker.status} (broker): ${order.symbol}`, broker.rejectionReason ?? broker.rawStatus)
    }
  }

  // ── 2. positions: our open LIVE rows vs broker net positions ──
  const [brokerPositions, ourOpenPositions] = await Promise.all([
    adapter.getPositions(),
    ledger.getOpenPositions(userId, 'live'),
  ])
  const brokerNetByToken = new Map<string, number>()
  for (const p of brokerPositions) {
    brokerNetByToken.set(p.symboltoken, (brokerNetByToken.get(p.symboltoken) ?? 0) + p.netQuantity)
  }

  for (const p of ourOpenPositions) {
    const net = brokerNetByToken.get(p.symbol_token) ?? 0
    if (net !== 0) continue // broker still holds exposure — ours is consistent
    // External close: broker is flat while we show open.
    let exitPrice = Number(p.average_entry_price)
    try {
      const quotes = await adapter.getLTP({ [(p.exchange ?? 'NSE') as string]: [p.symbol_token] })
      const q = quotes.find((x) => x.symboltoken === p.symbol_token)
      if (q && q.ltp > 0) exitPrice = q.ltp
    } catch {
      /* keep entry-price fallback */
    }
    await ledger.closePosition(p.id, { exitPrice, reason: 'reconciled_external' })
    const pnl = Math.round((p.side === 'LONG' ? exitPrice - Number(p.average_entry_price) : Number(p.average_entry_price) - exitPrice) * p.quantity * 100) / 100
    await ledger.insertTradeLog({
      userId,
      strategyId: p.strategy_id ?? '',
      symbol: p.symbol,
      side: p.side,
      quantity: p.quantity,
      entryPrice: Number(p.average_entry_price),
      exitPrice,
      pnl,
      mode: 'live',
      entryTime: p.opened_at,
      exitTime: new Date().toISOString(),
    })
    await recordClosedTrade(userId, pnl)
    summary.positionsClosed++
    summary.driftFlags.push(`${p.symbol} closed externally — booked @ ₹${exitPrice.toFixed(2)}`)
    await notify(userId, 'reconciliation_drift', `Position closed externally: ${p.symbol}`, `Broker position book is flat; booked @ ₹${exitPrice.toFixed(2)} · P&L ₹${pnl.toFixed(2)}`)
  }

  // ── 3. broker exposure we don't track (flag only) ──
  const ourTokens = new Set(ourOpenPositions.map((p) => p.symbol_token))
  const { data: liveStrategies } = await supabase
    .from('strategies')
    .select('symbol_token')
    .eq('user_id', userId)
    .eq('mode', 'live')
  const managedTokens = new Set([...ourTokens, ...(liveStrategies ?? []).map((s) => s.symbol_token)])
  for (const [token, net] of brokerNetByToken) {
    if (net !== 0 && !managedTokens.has(token)) {
      summary.driftFlags.push(`untracked broker exposure on token ${token} (net ${net}) — manual trade?`)
    }
  }
  if (summary.driftFlags.length > 0) {
    logger.warn('reconciliation drift', { userId, flags: summary.driftFlags })
    const untracked = summary.driftFlags.filter((f) => f.startsWith('untracked'))
    if (untracked.length > 0) {
      await notify(userId, 'reconciliation_drift', `Broker exposure not tracked by the engine (${untracked.length})`, untracked.join(' · '))
    }
  }
  return summary
}
