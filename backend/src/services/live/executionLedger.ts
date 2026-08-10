import { getServiceClient } from '../../supabase/client'
import type { OrderRow, PositionRow } from '../../supabase/types'
import { logger } from '../../lib/logger'
import type { LiveExitReason, PositionRuntimeState } from './liveTypes'

/**
 * Execution ledger — the ONLY writer of orders / positions / trade_logs rows
 * for the live engine and kill switch (spec §3.6 bookkeeping + RLS-safe: the
 * backend uses the service role and stamps user_id itself).
 */

export interface OpenOrderInput {
  userId: string
  strategyId: string
  /** Idempotency key — a worker restart re-deriving the same intent reuses the row. */
  clientRef: string
  purpose: 'entry' | 'exit'
  mode: 'paper' | 'live'
  symbol: string
  symbolToken: string
  exchange: string
  transactionType: 'BUY' | 'SELL'
  orderType: 'MARKET' | 'LIMIT'
  productType: string
  quantity: number
  price?: number
}

export async function openOrderIdempotent(input: OpenOrderInput): Promise<{ row: OrderRow; created: boolean }> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('orders')
    .insert({
      user_id: input.userId,
      strategy_id: input.strategyId,
      client_ref: input.clientRef,
      purpose: input.purpose,
      mode: input.mode,
      symbol: input.symbol,
      symbol_token: input.symbolToken,
      exchange: input.exchange,
      transaction_type: input.transactionType,
      order_type: input.orderType,
      product_type: input.productType,
      variety: 'NORMAL',
      quantity: input.quantity,
      price: input.price ?? null,
      status: 'pending',
    } as never)
    .select()
    .maybeSingle()

  if (error && (error as { code?: string }).code === '23505') {
    // Unique-violation on client_ref: the same intent was already placed — reuse it.
    const { data: existing, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('client_ref', input.clientRef)
      .maybeSingle()
    if (fetchError || !existing) throw new Error(`idempotent order fetch failed: ${fetchError?.message ?? 'row missing'}`)
    return { row: existing, created: false }
  }
  if (error || !data) throw new Error(`order insert failed: ${error?.message ?? 'no row'}`)
  return { row: data, created: true }
}

export async function markOrderBlocked(orderId: string, reason: string): Promise<void> {
  await getServiceClient().from('orders').update({ status: 'blocked', rejection_reason: reason } as never).eq('id', orderId)
}

export async function markOrderRejected(orderId: string, reason: string): Promise<void> {
  await getServiceClient().from('orders').update({ status: 'rejected', rejection_reason: reason } as never).eq('id', orderId)
}

export async function markOrderCancelled(orderId: string): Promise<void> {
  await getServiceClient().from('orders').update({ status: 'cancelled' } as never).eq('id', orderId)
}

export async function markOrderOpen(orderId: string, brokerOrderId: string): Promise<void> {
  await getServiceClient()
    .from('orders')
    .update({ status: 'open', broker_order_id: brokerOrderId } as never)
    .eq('id', orderId)
}

export async function markOrderComplete(orderId: string, fill: { averagePrice: number; filledQuantity: number }): Promise<void> {
  await getServiceClient()
    .from('orders')
    .update({ status: 'complete', average_price: fill.averagePrice, filled_quantity: fill.filledQuantity } as never)
    .eq('id', orderId)
}

export interface OpenPositionInput {
  userId: string
  strategyId: string
  symbol: string
  symbolToken: string
  exchange: string
  side: 'LONG' | 'SHORT'
  quantity: number
  entryPrice: number
  mode: 'paper' | 'live'
  runtimeState: PositionRuntimeState
}

export async function openPosition(input: OpenPositionInput): Promise<PositionRow> {
  const { data, error } = await getServiceClient()
    .from('positions')
    .insert({
      user_id: input.userId,
      strategy_id: input.strategyId,
      symbol: input.symbol,
      symbol_token: input.symbolToken,
      exchange: input.exchange,
      side: input.side,
      quantity: input.quantity,
      average_entry_price: input.entryPrice,
      mode: input.mode,
      status: 'open',
      runtime_state: input.runtimeState as never,
    } as never)
    .select()
    .single()
  if (error || !data) throw new Error(`position insert failed: ${error?.message ?? 'no row'}`)
  return data
}

export async function closePosition(
  positionId: string,
  exit: { exitPrice: number; reason: LiveExitReason },
): Promise<PositionRow> {
  const { data, error } = await getServiceClient()
    .from('positions')
    .update({ status: 'closed', close_reason: exit.reason, closed_at: new Date().toISOString() } as never)
    .eq('id', positionId)
    .eq('status', 'open')
    .select()
    .maybeSingle()
  if (error) throw new Error(`position close failed: ${error.message}`)
  if (!data) throw new Error(`position ${positionId} already closed`)
  return data
}

export async function updatePositionRuntime(positionId: string, state: PositionRuntimeState): Promise<void> {
  const { error } = await getServiceClient()
    .from('positions')
    .update({ runtime_state: state as never } as never)
    .eq('id', positionId)
  if (error) logger.warn('runtime_state persist failed', { positionId, error: error.message })
}

export async function insertTradeLog(input: {
  userId: string
  strategyId: string
  symbol: string
  side: 'LONG' | 'SHORT'
  quantity: number
  entryPrice: number
  exitPrice: number
  pnl: number
  mode: 'paper' | 'live'
  entryTime: string
  exitTime: string
}): Promise<void> {
  const { error } = await getServiceClient()
    .from('trade_logs')
    .insert(
      {
        user_id: input.userId,
        strategy_id: input.strategyId,
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
        entry_price: input.entryPrice,
        exit_price: input.exitPrice,
        pnl: input.pnl,
        mode: input.mode,
        entry_time: input.entryTime,
        exit_time: input.exitTime,
      } as never,
    )
  if (error) logger.warn('trade_logs insert failed', { error: error.message })
}

/** Today's entry fills for a strategy (survives worker restarts for the per-day trade gate). */
export async function countFilledEntryOrdersSince(strategyId: string, fromIso: string): Promise<number> {
  const { count, error } = await getServiceClient()
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('strategy_id', strategyId)
    .eq('purpose', 'entry')
    .eq('status', 'complete')
    .gte('placed_at', fromIso)
  if (error) throw new Error(`entry-order count failed: ${error.message}`)
  return count ?? 0
}

export async function getOpenPositionForStrategy(strategyId: string): Promise<PositionRow | null> {
  const { data, error } = await getServiceClient()
    .from('positions')
    .select('*')
    .eq('strategy_id', strategyId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`open position read failed: ${error.message}`)
  return data
}

export async function getOpenPositions(userId: string, mode?: 'paper' | 'live'): Promise<PositionRow[]> {
  let q = getServiceClient().from('positions').select('*').eq('user_id', userId).eq('status', 'open')
  if (mode) q = q.eq('mode', mode)
  const { data, error } = await q
  if (error) throw new Error(`open positions read failed: ${error.message}`)
  return data ?? []
}
